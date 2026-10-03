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
      local: { rules: { 'no-comments': noComments } },
    },
    rules: { 'local/no-comments': 'error' },
  },
  layer(['src/shared/**'], ['core', 'platforms', 'extension', 'ui']),
  layer(['src/core/**'], ['platforms', 'extension', 'ui']),
  layer(['src/platforms/youtube/**'], ['hbo', 'extension', 'ui']),
  layer(['src/platforms/hbo/**'], ['youtube', 'extension', 'ui']),
  layer(['src/extension/**'], ['core', 'platforms', 'ui']),
];
