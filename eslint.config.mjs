import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsParser from '@typescript-eslint/parser';

const repository = path.dirname(fileURLToPath(import.meta.url));

const noComments = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      unexpected: 'Comments are not allowed in TypeScript code.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: 'unexpected' });
        }
      },
    };
  },
};

const networkGlobals = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
]);

const providerTransport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bypass:
        'Provider POST must use src/shared/provider/transport.ts; retries also consume a send slot.',
      computed: 'Use a literal property name so network calls can be checked.',
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (!networkGlobals.has(node.name)) return;
        const parent = node.parent;
        if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
        if (parent.type === 'ImportSpecifier' || parent.type === 'TSPropertySignature') return;
        if (
          parent.type === 'MemberExpression' &&
          parent.property === node &&
          !parent.computed &&
          !['fetch', 'sendBeacon'].includes(node.name)
        )
          return;
        context.report({ node, messageId: 'bypass' });
      },
      MemberExpression(node) {
        if (!node.computed) return;
        if (node.property.type === 'Literal' && networkGlobals.has(node.property.value))
          context.report({ node, messageId: 'bypass' });
        else if (
          node.object.type === 'Identifier' &&
          ['globalThis', 'window', 'self'].includes(node.object.name) &&
          node.property.type !== 'Literal'
        )
          context.report({ node, messageId: 'computed' });
      },
    };
  },
};

const storageWriters = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      write:
        'Settings are written only by saveSettings in src/shared/storage.ts, which encrypts the API key. Keep other storage writes in src/shared/storage.ts, src/shared/token-usage.ts or src/extension/translation-store.ts.',
    },
  },
  create(context) {
    return {
      "CallExpression[callee.type='MemberExpression']"(node) {
        const method = node.callee.property.name;
        const target = context.sourceCode.getText(node.callee.object);
        if (
          /^chrome\.storage\.(local|session|sync)$/.test(target) &&
          ['set', 'remove', 'clear'].includes(method)
        )
          context.report({ node, messageId: 'write' });
        if (
          /(^|\.)localStorage$/.test(target) &&
          ['setItem', 'removeItem', 'clear'].includes(method)
        )
          context.report({ node, messageId: 'write' });
      },
    };
  },
};

const cjk = /[㐀-鿿]/;

function copyName(node) {
  if (node.type === 'Identifier') return /(^message$|Message$)/.test(node.name) ? node.name : null;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
    return ['message', 'textContent', 'innerText'].includes(node.property.name)
      ? `.${node.property.name}`
      : null;
  if (node.type === 'Literal' && typeof node.value === 'string' && cjk.test(node.value))
    return `'${node.value}'`;
  return null;
}

function rewritesSameNode(node, sourceCode) {
  const statement = node.parent;
  if (statement?.type !== 'IfStatement' || statement.test !== node || node.operator !== '!==')
    return false;
  const body =
    statement.consequent.type === 'BlockStatement' && statement.consequent.body.length === 1
      ? statement.consequent.body[0]
      : statement.consequent;
  const assignment = body.type === 'ExpressionStatement' ? body.expression : null;
  return (
    assignment?.type === 'AssignmentExpression' &&
    sourceCode.getText(assignment.left) === sourceCode.getText(node.left) &&
    sourceCode.getText(assignment.right) === sourceCode.getText(node.right)
  );
}

const typedOutcomes = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      compare:
        "Don't decide state by comparing {{name}}. Carry the outcome as a typed kind: TranslateFailure in src/shared/provider-error.ts across messages, TranslationLine in src/core/overlay.ts for what a caption shows.",
      dom: "Don't read {{name}} back as state. CaptionTranslator owns what a caption shows; keep the state in its TranslationLine.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const copyConstants = new Set();
    return {
      'Program > VariableDeclaration > VariableDeclarator, Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator'(
        node,
      ) {
        if (
          node.id.type === 'Identifier' &&
          node.init?.type === 'Literal' &&
          typeof node.init.value === 'string' &&
          cjk.test(node.init.value)
        )
          copyConstants.add(node.id.name);
      },
      BinaryExpression(node) {
        if (!['===', '!==', '==', '!='].includes(node.operator)) return;
        if (rewritesSameNode(node, sourceCode)) return;
        for (const side of [node.left, node.right]) {
          const name =
            copyName(side) ??
            (side.type === 'Identifier' && copyConstants.has(side.name) ? side.name : null);
          if (name) {
            context.report({ node, messageId: 'compare', data: { name } });
            return;
          }
        }
      },
      SwitchStatement(node) {
        const name = copyName(node.discriminant);
        if (name) context.report({ node, messageId: 'compare', data: { name } });
      },
      "CallExpression[callee.property.name='contains'][callee.object.property.name='classList']"(
        node,
      ) {
        context.report({ node, messageId: 'dom', data: { name: 'classList' } });
      },
    };
  },
};

const writeOnlyOverlay = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      state:
        'SubtitleOverlay only renders. {{member}} exposes state; keep it in CaptionTranslator or CaptionController and pass it to render() or mount().',
    },
  },
  create(context) {
    return {
      'ClassDeclaration[id.name="SubtitleOverlay"] > ClassBody > *'(node) {
        if (node.type === 'StaticBlock') return;
        const name = node.key?.name ?? node.key?.value ?? '?';
        if (node.key?.type === 'PrivateIdentifier' || node.accessibility === 'private') return;
        if (node.type === 'PropertyDefinition' || node.type === 'AccessorProperty')
          return context.report({ node, messageId: 'state', data: { member: name } });
        if (node.type === 'MethodDefinition' && (node.kind === 'get' || node.kind === 'set'))
          return context.report({ node, messageId: 'state', data: { member: name } });
        if (node.type === 'MethodDefinition' && node.kind === 'method') {
          if (name === 'showsIn') return;
          const returns = node.value.returnType?.typeAnnotation?.type;
          if (returns && returns !== 'TSVoidKeyword')
            context.report({ node, messageId: 'state', data: { member: name } });
        }
      },
    };
  },
};

const tuningHome = {
  meta: {
    type: 'problem',
    schema: [{ type: 'array', items: { type: 'string' } }],
    messages: {
      home: '{{name}} is a named number outside src/shared/tuning.ts. Put numbers that shape playback, Provider traffic or what a caption shows in src/shared/tuning.ts.',
    },
  },
  create(context) {
    const existing = new Set(context.options[0] ?? []);
    const numeric = (node) =>
      node?.type === 'Literal'
        ? typeof node.value === 'number'
        : node?.type === 'UnaryExpression'
          ? numeric(node.argument)
          : node?.type === 'BinaryExpression'
            ? numeric(node.left) || numeric(node.right)
            : false;
    return {
      'Program > VariableDeclaration > VariableDeclarator, Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator'(
        node,
      ) {
        if (node.parent.kind !== 'const' || node.id.type !== 'Identifier') return;
        if (numeric(node.init) && !existing.has(node.id.name))
          context.report({ node, messageId: 'home', data: { name: node.id.name } });
      },
    };
  },
};

const dependencyBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      boundary:
        'Use src/core/platform.ts for platform adapters and src/core/sentences.ts for shared subtitle semantics; dependencies flow platforms → core → shared and platforms never import each other.',
      dynamic: 'Use a literal module path so subtitle dependency boundaries can be checked.',
    },
  },
  create(context) {
    const root = path.join(repository, 'src');
    const relative = (filename) => path.relative(root, filename).split(path.sep);
    const [layer, platform] = relative(context.filename);
    const forbidden = {
      shared: ['core', 'platforms', 'extension', 'ui'],
      core: ['platforms', 'extension', 'ui'],
      extension: ['core', 'platforms', 'ui'],
      platforms: ['extension', 'ui'],
      ui: ['core', 'platforms', 'extension'],
      'main.tsx': ['core', 'platforms', 'extension'],
    }[layer];
    if (!forbidden) return {};
    function check(source) {
      if (!source || typeof source.value !== 'string') {
        if (source) context.report({ node: source, messageId: 'dynamic' });
        return;
      }
      const specifier = source.value;
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('src/'))
        return;
      const resolved = specifier.startsWith('src/')
        ? path.join(repository, specifier)
        : path.resolve(path.dirname(context.filename), specifier);
      const [target, targetPlatform] = relative(resolved);
      if (
        forbidden.includes(target) ||
        (layer === 'platforms' && target === 'platforms' && targetPlatform !== platform)
      )
        context.report({ node: source, messageId: 'boundary' });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node.source);
      },
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
      TSExternalModuleReference: (node) => check(node.expression),
      CallExpression: (node) => {
        if (node.callee.name === 'require') check(node.arguments[0]);
      },
    };
  },
};

export default [
  { ignores: ['dist/**', 'coverage/**', '.artifacts/**'] },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tsParser },
    linterOptions: { noInlineConfig: true },
    plugins: {
      local: {
        rules: {
          'no-comments': noComments,
          'provider-transport': providerTransport,
          'dependency-boundaries': dependencyBoundaries,
          'typed-outcomes': typedOutcomes,
          'write-only-overlay': writeOnlyOverlay,
          'tuning-home': tuningHome,
          'storage-writers': storageWriters,
        },
      },
    },
    rules: { 'local/no-comments': 'error' },
  },
  {
    files: ['src/shared/**/*.ts', 'src/extension/**/*.ts', 'src/ui/**/*.{ts,tsx}'],
    ignores: ['src/shared/provider/transport.ts'],
    rules: { 'local/provider-transport': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/shared/storage.ts',
      'src/shared/token-usage.ts',
      'src/extension/translation-store.ts',
    ],
    rules: { 'local/storage-writers': 'error' },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { 'local/dependency-boundaries': 'error' },
  },
  {
    files: ['src/core/**/*.ts', 'src/extension/**/*.ts', 'src/shared/**/*.ts'],
    rules: { 'local/typed-outcomes': 'error' },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/shared/tuning.ts'],
    rules: {
      'local/tuning-home': [
        'error',
        [
          'cueLimit',
          'cueTextLimit',
          'SEEK_JUMP_TOLERANCE',
          'HEARTBEAT_MS',
          'translationCacheLimit',
          'minClauseColumns',
          'lineCost',
          'overflowCost',
          'balanceCost',
          'TRACE_TEXT_LIMIT',
        ],
      ],
    },
  },
  {
    files: ['src/core/overlay.ts'],
    rules: { 'local/write-only-overlay': 'error' },
  },
  {
    files: ['src/extension/**/*.ts'],
    ignores: ['src/extension/background.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)shared/api(\\.ts)?$',
              importNames: ['translate'],
              message:
                'Caption queues must use translateCaptionBatch; free-text translation is only for connection checks.',
            },
          ],
        },
      ],
    },
  },
];
