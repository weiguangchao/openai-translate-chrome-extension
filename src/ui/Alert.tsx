import { CircleCheck, CircleAlert, Info, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type AlertMessage = {
  kind: 'success' | 'error' | 'info';
  text: string;
  detail?: string;
};
type Notice = AlertMessage & { id: number };

function Alert({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const [closing, setClosing] = useState(false);
  const Icon =
    notice.kind === 'success' ? CircleCheck : notice.kind === 'error' ? CircleAlert : Info;

  useEffect(() => {
    const timer = setTimeout(() => setClosing(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onDismiss(notice.id), 180);
    return () => clearTimeout(timer);
  }, [closing, notice.id, onDismiss]);

  return createPortal(
    <div className="alert-layer">
      <div
        className={`settings-alert ${notice.kind}${closing ? ' is-closing' : ''}`}
        role={notice.kind === 'error' ? 'alert' : 'status'}
        aria-atomic="true"
      >
        <Icon size={19} className="alert-icon" aria-hidden />
        <div className="alert-content">
          <p>{notice.text}</p>
          {notice.detail && <p className="alert-detail">{notice.detail}</p>}
        </div>
        <button
          type="button"
          className="alert-close"
          aria-label="关闭提示"
          onClick={() => setClosing(true)}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function useAlert() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const nextId = useRef(0);
  const showAlert = useCallback((message: AlertMessage) => {
    setNotice({ ...message, id: ++nextId.current });
  }, []);
  const dismiss = useCallback((id: number) => {
    setNotice((current) => (current?.id === id ? null : current));
  }, []);

  return {
    showAlert,
    alert: notice && <Alert key={notice.id} notice={notice} onDismiss={dismiss} />,
  };
}
