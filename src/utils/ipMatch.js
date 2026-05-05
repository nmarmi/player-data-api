/**
 * US-10.5: IPv4 exact-match and CIDR matching — no external dependencies.
 */

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | parseInt(octet, 10)) >>> 0, 0);
}

/** Returns true if `ip` falls within the CIDR block or equals the exact address. */
function cidrMatch(ip, entry) {
  if (!entry.includes('/')) return ip === entry;
  const [network, bits] = entry.split('/');
  const prefixLen = parseInt(bits, 10);
  const mask = prefixLen === 0 ? 0 : ((0xffffffff << (32 - prefixLen)) >>> 0);
  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}

/**
 * Returns true when the request IP is allowed by the whitelist.
 * An empty or null whitelist means no restriction (all IPs pass).
 * @param {string|null} requestIp
 * @param {string[]} whitelist
 */
function ipAllowed(requestIp, whitelist) {
  if (!whitelist || whitelist.length === 0) return true;
  if (!requestIp) return false; // can't verify — deny when whitelist is set
  return whitelist.some((entry) => cidrMatch(requestIp, entry));
}

module.exports = { ipAllowed, cidrMatch };
