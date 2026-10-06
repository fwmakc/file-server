import { createHmac } from "crypto";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { AccountInfo } from "api-server-toolkit/auth-client";

/**
 * Test-only JWT plumbing: a real HS256 token carried in a header, verified
 * by a 'jwt' strategy swap. Guards (@Account / @Account("noBlock")) resolve
 * it exactly like production tokens; anonymous requests just omit the
 * header and JwtPublicGuard yields the public pseudo-account.
 */
export const TEST_ACCOUNT_HEADER = "x-test-account";
const TEST_SECRET = "test-secret";

const b64u = (input: string): string =>
  Buffer.from(input, "utf8").toString("base64url");

export const signTestToken = (account: AccountInfo): string => {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(
    JSON.stringify({ ...account, type: "access", iat: 1794000000 }),
  );
  const sig = createHmac("sha256", TEST_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
};

export const asAccount = (
  account?: AccountInfo | null,
): Record<string, string> =>
  account ? { [TEST_ACCOUNT_HEADER]: signTestToken(account) } : {};

export class TestAccountStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => req?.headers?.[TEST_ACCOUNT_HEADER] ?? null,
      ]),
      ignoreExpiration: true,
      secretOrKeyProvider: (_req, _token, done) => done(null, TEST_SECRET),
      algorithms: ["HS256"],
    });
  }

  validate(payload: AccountInfo): AccountInfo {
    return payload;
  }
}
