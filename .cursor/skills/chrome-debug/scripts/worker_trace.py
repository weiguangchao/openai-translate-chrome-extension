import math

GAP_SECONDS = 3
MAX_RATE = 4
SPARSE_SHARE = 0.8
CUE_SLACK_SECONDS = 0.5
FLASH_SECONDS = 0.3
TOGETHER_SECONDS = 0.3
SCHEDULE_FIELDS = ("videoTime", "playbackRate", "start", "end", "predictedMs", "slack", "inFlight", "blocked", "atRisk")


def r1(value):
    return None if value is None else round(value, 1)


def r2(value):
    return None if value is None else round(value, 2)


def nearest_rank(values, share):
    values = sorted(values)
    return values[max(0, math.ceil(share * len(values)) - 1)] if values else None


def collect_batches(events, tab):
    batches = []
    latest = {}
    for stamp, event in events:
        kind, number = event.get("e"), event.get("id")
        if kind == "batch":
            latest.pop(number, None)
            if event.get("tab") == tab:
                batch = {"id": number, "seg": event.get("seg"), "size": event.get("size"), "queued": stamp}
                batch.update({key: event[key] for key in SCHEDULE_FIELDS if key in event})
                batches.append(batch)
                latest[number] = batch
        elif kind in ("sent", "first", "done") and number in latest:
            latest[number][kind] = stamp
            if kind == "done":
                latest[number]["result"] = event.get("result")
    return batches


def continuous(video_step, wall_step):
    return 0 <= wall_step <= GAP_SECONDS and 0 <= video_step <= wall_step * MAX_RATE + 0.5


def caption_key(view):
    if "cue" in view:
        return ("cue", view["cue"])
    return ("text", view["text"]) if view.get("text") else None


def walk(window):
    states = {}
    caption_seconds = ready_seconds = counted = 0.0
    sentences, episodes = [], []
    current = episode = None
    for index, (stamp, view) in enumerate(window):
        following = window[index + 1] if index + 1 < len(window) else None
        step = following[1]["t"] - view["t"] if following else 0
        wall = (following[0] - stamp) / 1000 if following else 0
        lasting = step if following and continuous(step, wall) and not view.get("paused") else 0
        counted += lasting
        state = view.get("state")
        states[state] = states.get(state, 0) + lasting
        key = caption_key(view)
        if key:
            caption_seconds += lasting
            if state == "ready":
                ready_seconds += lasting
        jumped = current is not None and not continuous(
            view["t"] - current["last"], (stamp - current["lastStamp"]) / 1000
        )
        if key is None or current is None or key != current["key"] or jumped:
            current = None
            if key is not None:
                current = {
                    "key": key,
                    "first": view["t"],
                    "last": view["t"],
                    "lastStamp": stamp,
                    "start": view.get("start", view["t"]),
                    "seg": view.get("seg"),
                    "text": view.get("text", ""),
                    "ready": None,
                    "readyStamp": None,
                    "readyOnArrival": state == "ready",
                }
                sentences.append(current)
        if current is not None:
            current["last"] = view["t"]
            current["lastStamp"] = stamp
            if state == "ready" and current["ready"] is None:
                current["ready"], current["readyStamp"] = view["t"], stamp
        if state == "loading":
            if episode is None:
                episode = {"at": view["t"], "seconds": 0.0, "then": "end", "seg": view.get("seg"),
                           "text": view.get("text", "")}
                episodes.append(episode)
            episode["seconds"] += lasting
        elif episode is not None:
            episode["then"] = state
            episode = None
    return states, caption_seconds, ready_seconds, sentences, episodes, counted


def lag_of(sentence):
    if sentence["ready"] is None:
        return None
    if sentence["readyOnArrival"]:
        return 0.0
    late_start = sentence["first"] - sentence["start"] > CUE_SLACK_SECONDS
    return max(0.0, sentence["ready"] - (sentence["first"] if late_start else sentence["start"]))


def clock(stats, rates, visible, samples):
    if not samples or not rates:
        return
    rate = max(rates, key=rates.get)
    share = round(visible / samples, 2)
    stats["playbackRate"] = rate
    stats["visible"] = share
    wall = stats.get("wall")
    played = stats.get("played") or 0
    off = share < 0.5
    if isinstance(wall, (int, float)) and wall >= 5 and rate:
        if abs(played / wall - rate) > 0.2 * abs(rate):
            off = True
    if off:
        stats["clock"] = "throttled"


def trace_line(stats):
    lag = stats.get("lag") or {}
    text = ", ".join([
        f"from {stats.get('from')}",
        f"played {stats.get('played')}",
        f"counted {stats.get('counted')}",
        f"wall {stats.get('wall')}",
        f"rate {stats.get('playbackRate')}",
        f"visible {stats.get('visible')}",
        f"coverage {stats.get('coverage')}",
        f"missed {lag.get('missed')}",
        f"lag.max {lag.get('max')}",
    ])
    if stats.get("clock") == "throttled":
        text += ", throttled"
    if stats.get("sparse"):
        text += ", sparse"
    return text


def batch_view(batch):
    def between(a, b):
        return r2((batch[b] - batch[a]) / 1000) if a in batch and b in batch else None

    return {"id": batch["id"], "seg": batch["seg"], "size": batch["size"], "result": batch.get("result"),
            **{key: batch[key] for key in SCHEDULE_FIELDS if key in batch},
            "wait": between("queued", "sent"), "first": between("sent", "first"),
            "roundTrip": between("sent", "done")}


def summarize(events, run, started, played):
    views = [(stamp, event) for stamp, event in events if event.get("e") == "view" and event.get("run") == run]
    tab = views[0][1].get("tab") if views else None
    batches = collect_batches(events, tab)
    window = [(stamp, view) for stamp, view in views if stamp >= started and not view.get("seeking")]
    states, caption_seconds, ready_seconds, sentences, everything, counted = walk(window)
    episodes = [e for e in everything if e["seconds"] >= FLASH_SECONDS]

    for sentence in sentences:
        sentence["lag"] = lag_of(sentence)
        ready_by = sentence["readyStamp"] or math.inf
        matching = [b for b in batches if b["queued"] <= ready_by and (
            b["start"] <= sentence["start"] < b["end"] if "start" in b and "end" in b
            else b["seg"] == sentence["seg"]
        )]
        sentence["batch"] = batch_view(matching[-1]) if matching else None
    lags = [s["lag"] for s in sentences if s["lag"] is not None]
    shown_batches = [batch_view(batch) for batch in batches]

    def timings(field):
        return [b[field] for b in shown_batches if b[field] is not None]

    round_trips, first_items, waits = timings("roundTrip"), timings("first"), timings("wait")
    results = {}
    for batch in batches:
        result = batch.get("result", "pending")
        results[result] = results.get(result, 0) + 1
    opening = [
        {key: batch[key] for key in ("seg", "size", "result", "wait", "first", "roundTrip")}
        for batch in shown_batches[:3]
    ]
    together = sum(
        batch["first"] is not None and batch["roundTrip"] is not None
        and abs(batch["first"] - batch["roundTrip"]) <= TOGETHER_SECONDS
        for batch in shown_batches
    )
    first_caption = next(((stamp, view) for stamp, view in window if caption_key(view)), None)
    first_ready = next(((stamp, view) for stamp, view in window if view.get("state") == "ready"), None)

    stats = {
        "from": r1(window[0][1]["t"]) if window else None,
        "to": r1(window[-1][1]["t"]) if window else None,
        "played": r1(played),
        "wall": r1((window[-1][0] - started) / 1000) if window else None,
        "views": len(window),
        "counted": r1(counted),
        "states": {state: r1(seconds) for state, seconds in states.items()},
        "coverage": r1(100 * ready_seconds / caption_seconds) if caption_seconds else None,
        "firstCaptionAt": r1(first_caption[1]["t"]) if first_caption else None,
        "firstReadyAt": r1(first_ready[1]["t"]) if first_ready else None,
        "firstReadyWall": r1((first_ready[0] - started) / 1000) if first_ready else None,
        "loading": {
            "episodes": len(episodes),
            "seconds": r1(sum(e["seconds"] for e in episodes)),
            "longest": r1(max((e["seconds"] for e in episodes), default=0)),
            "flashes": len(everything) - len(episodes),
        },
        "lag": {
            "sentences": len(sentences),
            "measured": len(lags),
            "missed": len(sentences) - len(lags),
            "p50": r1(nearest_rank(lags, 0.5)),
            "p90": r1(nearest_rank(lags, 0.9)),
            "max": r1(max(lags, default=None)),
            "over1s": sum(lag > 1 for lag in lags),
        },
        "batches": {
            "count": len(batches),
            "results": results,
            "p50": r2(nearest_rank(round_trips, 0.5)),
            "p90": r2(nearest_rank(round_trips, 0.9)),
            "max": r2(max(round_trips, default=None)),
            "firstItemP50": r2(nearest_rank(first_items, 0.5)),
            "waitMax": r2(max(waits, default=None)),
            "opening": opening,
            "together": together,
        },
    }
    if played and counted < SPARSE_SHARE * played:
        stats["sparse"] = True
    shown_sentences = [
        {"at": r1(s["ready"] if s["ready"] is not None else s["first"]), "lag": r1(s["lag"]), "seg": s["seg"],
         "text": s["text"], "batch": s["batch"]}
        for s in sentences
    ]
    shown_episodes = [
        {"at": r1(e["at"]), "seconds": r1(e["seconds"]), "then": e["then"], "seg": e["seg"], "text": e["text"]}
        for e in episodes
    ]
    return {
        "stats": stats,
        "sentences": shown_sentences,
        "episodes": shown_episodes,
        "batches": shown_batches,
    }
