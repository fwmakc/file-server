/**
 * Папка назначения: сегменты только из [\w], слэши — разделители.
 * `..` превращается в пустой сегмент и отбрасывается — traversal невозможен.
 */
export const sanitizeFolderPath = (folder: unknown): string =>
  String(folder ?? "")
    .split(/[\\/]+/)
    .map((segment) => segment.replace(/[^\w]/gu, ""))
    .filter(Boolean)
    .join("/");

/**
 * Путь из входящего запроса: зеркально sanitizeFilename из save.handler —
 * сегменты без управляющих символов, `.`/`..`/пустые отбрасываются.
 */
export const sanitizeRequestPath = (path: unknown): string =>
  String(path ?? "")
    .split(/[\\/]+/)
    .map((segment) => segment.replace(/[\u0000-\u001f\u007f]/gu, "").trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
