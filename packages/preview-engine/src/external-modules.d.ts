declare module "@lattice-ui/compiler" {
  export type UnsupportedPatternError = {
    code: string;
    message: string;
    file: string;
    line: number;
    column: number;
    symbol?: string;
    target: string;
  };

  export type TransformPreviewSourceOptions = {
    filePath: string;
    runtimeModule: string;
    target: string;
  };

  export type TransformPreviewSourceResult = {
    code: string;
    errors: UnsupportedPatternError[];
  };

  export function transformPreviewSource(
    code: string,
    options: TransformPreviewSourceOptions,
  ): TransformPreviewSourceResult;
}
