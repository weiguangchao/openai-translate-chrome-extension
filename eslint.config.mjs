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

function layer(files, forbidden) {
  return {
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `(^|/)(${forbidden.join('|')})/`,
              message:
                'Dependencies flow platforms → core → shared; platforms never import each other.',
            },
          ],
        },
      ],
    },
  };
}

export default [
  { ignores: ['dist/**', 'coverage/**', '.artifacts/**'] },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tsParser },
    linterOptions: { noInlineConfig: true },
    plugins: {
      local: { rules: { 'no-comments': noComments, 'provider-transport': providerTransport } },
    },
    rules: { 'local/no-comments': 'error' },
  },
  {
    files: ['src/shared/api.ts', 'src/shared/provider/**/*.ts'],
    ignores: ['src/shared/provider/transport.ts'],
    rules: { 'local/provider-transport': 'error' },
  },
  layer(['src/shared/**'], ['core', 'platforms', 'extension', 'ui']),
  layer(['src/core/**'], ['platforms', 'extension', 'ui']),
  layer(['src/platforms/youtube/**'], ['hbo', 'extension', 'ui']),
  layer(['src/platforms/hbo/**'], ['youtube', 'extension', 'ui']),
  layer(['src/extension/**'], ['core', 'platforms', 'ui']),
];
