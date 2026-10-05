import path from 'node:path';
import tsParser from '@typescript-eslint/parser';

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

const providerTransport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bypass:
        'Provider POST must use src/shared/provider/transport.ts; retries also consume a send slot.',
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name === 'fetch') context.report({ node, messageId: 'bypass' });
      },
      "MemberExpression[computed=true] > Literal.property[value='fetch']"(node) {
        context.report({ node, messageId: 'bypass' });
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
    const root = path.resolve('src');
    const relative = (filename) => path.relative(root, filename).split(path.sep);
    const [layer, platform] = relative(context.filename);
    const forbidden = {
      shared: ['core', 'platforms', 'extension', 'ui'],
      core: ['platforms', 'extension', 'ui'],
      extension: ['core', 'platforms', 'ui'],
      platforms: ['extension', 'ui'],
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
        ? path.resolve(specifier)
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
        },
      },
    },
    rules: { 'local/no-comments': 'error' },
  },
  {
    files: ['src/shared/**/*.ts'],
    ignores: ['src/shared/provider/transport.ts'],
    rules: { 'local/provider-transport': 'error' },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { 'local/dependency-boundaries': 'error' },
  },
  {
    files: ['src/extension/queue.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../shared/api',
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
