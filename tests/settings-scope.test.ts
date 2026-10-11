import ts from 'typescript';
import { expect, it } from 'vitest';

it('refuses to compile a new setting until it is given a scope', () => {
  const fixture = ts.sys.resolvePath('tests/settings-scope.fixture.ts');
  const settings = ts.sys.resolvePath('src/shared/settings.ts');
  const source = `
export {};
declare module '../src/shared/settings' {
  interface Settings {
    temperature: number;
  }
}
`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fixture
      ? ts.createSourceFile(name, source, languageVersion, true)
      : read(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixture, settings], options, host);
  const flagged = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === settings)
    .map((diagnostic) => {
      const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
      return diagnostic.file!.text.split('\n')[line].trim();
    });
  expect(flagged).toContainEqual(expect.stringMatching(/^const SETTING_SCOPES\b/));
});
