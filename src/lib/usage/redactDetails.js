export function redactDetails(details) {
  return (details || []).map((d) => {
    const redacted = { ...d };
    for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
      if (redacted[key] !== undefined) {
        redacted[key] = { redacted: true };
      }
    }
    return redacted;
  });
}
