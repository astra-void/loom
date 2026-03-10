import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAutoMockPropsPlugin } from "../../../packages/preview/src/source/autoMockPlugin";
import { getHookHandler } from "./hookTestUtils";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("createAutoMockPropsPlugin", () => {
  it("injects preview props metadata for anonymous default exported components behind decorated ids", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-auto-mock-"));
    temporaryRoots.push(fixtureRoot);

    const sourceRoot = path.join(fixtureRoot, "src");
    const sourceFile = path.join(sourceRoot, "index.tsx");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          module: "esnext",
          target: "esnext",
        },
      }),
      "utf8",
    );

    const source = `
      type Props = {
        index: number;
        spell: {
          name: string;
        };
      };

      export default (props: Props) => <textlabel Text={tostring(props.index + 1)} />;
    `;
    fs.writeFileSync(sourceFile, source, "utf8");

    const plugin = createAutoMockPropsPlugin({
      targets: [
        {
          name: "fixture",
          packageRoot: fixtureRoot,
          sourceRoot,
        },
      ],
    });

    const transform = getHookHandler(plugin.transform);
    const transformed = await transform?.call({} as never, source, `${sourceFile}?source=preview#component`);

    expect(transformed && typeof transformed === "object" ? transformed.code : transformed).toContain(
      "const __previewDefaultExport =",
    );
    expect(transformed && typeof transformed === "object" ? transformed.code : transformed).toContain(
      "__previewDefaultExport.__previewProps",
    );
    expect(transformed && typeof transformed === "object" ? transformed.code : transformed).toContain('"index"');
    expect(transformed && typeof transformed === "object" ? transformed.code : transformed).toContain('"spell"');
  });

  it("matches source files when the configured source root is a symlink", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-auto-mock-symlink-"));
    temporaryRoots.push(fixtureRoot);

    const realSourceRoot = path.join(fixtureRoot, "real-src");
    const linkedSourceRoot = path.join(fixtureRoot, "linked-src");
    const sourceFile = path.join(realSourceRoot, "Symlinked.tsx");
    const source =
      "export default function Symlinked(props: { label: string }) { return <textlabel Text={props.label} />; }\n";

    fs.mkdirSync(realSourceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          module: "esnext",
          target: "esnext",
        },
      }),
      "utf8",
    );
    fs.writeFileSync(sourceFile, source, "utf8");
    fs.symlinkSync(realSourceRoot, linkedSourceRoot);

    const plugin = createAutoMockPropsPlugin({
      targets: [
        {
          name: "fixture",
          packageRoot: fixtureRoot,
          sourceRoot: linkedSourceRoot,
        },
      ],
    });

    const transform = getHookHandler(plugin.transform);
    const transformed = await transform?.call({} as never, source, sourceFile);

    expect(transformed && typeof transformed === "object" ? transformed.code : transformed).toContain(
      "Symlinked.__previewProps",
    );
    expect(transformed && typeof transformed === "object" ? transformed.code : transformed).toContain('"label"');
  });
});
