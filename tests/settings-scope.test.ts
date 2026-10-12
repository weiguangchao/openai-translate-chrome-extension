import ts from 'typescript';
import { expect, it } from 'vitest';

it('refuses to compile a new setting until it is given a scope', () => {
  const fixture = ts.sys.resolvePath('tests/settings-scope.fixture.ts');
  const settings = ts.sys.resolvePath('src/shared/settings.ts');
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const compile = (addSetting: boolean) => {
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (name === fixture)
        return ts.createSourceFile(
          name,
          addSetting
            ? `
export {};
declare module '../src/shared/settings' {
  interface Settings {
    temperature: number;
  }
}
`
            : 'export {};',
          languageVersion,
          true,
        );
      const source = read(name, languageVersion, onError, shouldCreateNewSourceFile);
      if (!addSetting || name !== settings || !source) return source;
      const defaults = source.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .find((declaration) => declaration.name.getText(source) === 'DEFAULT_SETTINGS');
      expect(defaults?.initializer && ts.isObjectLiteralExpression(defaults.initializer)).toBe(
        true,
      );
      const at = defaults!.initializer!.getStart(source) + 1;
      return ts.createSourceFile(
        name,
        source.text.slice(0, at) + ' temperature: 0,' + source.text.slice(at),
        languageVersion,
        true,
      );
    };
    const program = ts.createProgram([fixture, settings], options, host);
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }));
  };
  expect(compile(false)).toEqual([]);
  expect(compile(true)).toEqual([
    {
      code: 2741,
      message: expect.stringMatching(/Property 'temperature' is missing/),
    },
  ]);
});
