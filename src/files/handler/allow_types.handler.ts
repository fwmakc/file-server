import { Injectable } from "@nestjs/common";
import { FilesInterface } from "@src/files/files.interface";

@Injectable()
export class AllowTypesHandler {
  allowTypes(file: FilesInterface) {
    let types = process.env.UPLOADS_ALLOW_TYPES || "";
    if (!types) {
      return true;
    }
    if (Array.isArray(types)) {
      types = types.join(";");
    }
    // Exact tokens only: a substring match would let "image/png" in the
    // allowlist implicitly admit every image/* type (svg+xml included —
    // stored XSS), and "text" would admit text/html.
    const allowed = String(types)
      .split(/[;,|\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const mimetype = String(file.mimetype || "").toLowerCase();
    const [major, minor = ""] = mimetype.split("/");
    return (
      allowed.includes(mimetype) ||
      allowed.includes(major) ||
      allowed.includes(minor)
    );
  }
}
