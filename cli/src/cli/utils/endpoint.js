async function getEndpoint(port) {
  return { endpoint: `http://localhost:${port}/v1` };
}

module.exports = { getEndpoint };
