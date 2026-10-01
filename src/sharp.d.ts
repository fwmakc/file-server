// sharp 0.35 ships ESM-only typings (dist/index.d.mts), but its CommonJS
// entry (dist/index.cjs) is a plain callable `module.exports = Sharp` with
// no `.default`. This build compiles to CommonJS, where `import * as sharp
// from "sharp"` yields exactly that callable at runtime; this shadow
// declaration restores the callable view for tsc (no sharp.* type members
// are referenced in this codebase — only the factory call).
declare module "sharp" {
  function sharp(input?: unknown, options?: unknown): any;
  export = sharp;
}
