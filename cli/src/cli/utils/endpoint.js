const api = require("../api/client");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m"
};

/**
 * Get endpoint URL for the local server.
 * @param {number} port - Local server port
 * @returns {Promise<{endpoint: string}>}
 */
async function getEndpoint(port) {
  return { endpoint: `http://localhost:${port}/v1` };
}

/**
 * Get endpoint with color formatting
 * @param {number} port - Local server port
 * @returns {Promise<string>} Colored endpoint string
 */
async function getEndpointColored(port) {
  const { endpoint } = await getEndpoint(port);
  return endpoint;
}

module.exports = { getEndpoint, getEndpointColored };
