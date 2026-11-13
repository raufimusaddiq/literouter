const PROVIDER_SPECIFIC_SECRETS = ["opendesignControlKey"];

export function toProviderConnectionResponse(connection) {
  const { apiKey, accessToken, refreshToken, idToken, ...safe } = connection || {};
  const psd = safe.providerSpecificData;
  if (!psd || typeof psd !== "object" || !PROVIDER_SPECIFIC_SECRETS.some((key) => Object.hasOwn(psd, key))) {
    return safe;
  }
  const providerSpecificData = { ...psd };
  for (const key of PROVIDER_SPECIFIC_SECRETS) delete providerSpecificData[key];
  return { ...safe, providerSpecificData };
}
