/* eslint-disable */
// `jose` v6 is ESM-only and jest's CJS runtime cannot parse it. The specs
// stub AuthClientService anyway, so the real JWKS machinery never executes —
// these are just the names jwks-rsa touches at import time.
export const importJWK = async () => ({});
export const exportSPKI = async () => "";
export const createRemoteJWKSet = () => async () => ({});
export const createLocalJWKSet = () => async () => ({});
export const jwtVerify = async () => ({ payload: {}, protectedHeader: {} });
