/**
 * IP Whitelist Middleware
 * Allows access only from whitelisted IP addresses/networks
 * Supports both individual IPs and CIDR notation for subnets
 */

// Get client IP from request, handling proxies
const getClientIP = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

// Check if IP is in subnet using simple string matching for /16 networks
const isIPInSubnet = (clientIP, subnet) => {
  // Remove IPv6 prefix if present
  clientIP = clientIP.replace(/^::ffff:/, '');
  
  if (subnet.includes('/16')) {
    // For /16 networks like 192.168.169.0/16, match first two octets
    const subnetParts = subnet.split('/')[0].split('.');
    const clientParts = clientIP.split('.');
    return subnetParts[0] === clientParts[0] && subnetParts[1] === clientParts[1];
  }
  
  if (subnet.includes('/24')) {
    // For /24 networks like 192.168.169.0/24, match first three octets
    const subnetParts = subnet.split('/')[0].split('.');
    const clientParts = clientIP.split('.');
    return subnetParts[0] === clientParts[0] && 
           subnetParts[1] === clientParts[1] && 
           subnetParts[2] === clientParts[2];
  }
  
  // Exact match for single IPs
  return clientIP === subnet;
};

// Whitelist configuration
const WHITELIST = [
  '127.0.0.1',           // Localhost
  '192.168.169.0/16',    // Local network (192.168.169.x)
  // '30.0.39.61',          // VPN user - Your VPN IP
];

const ipWhitelistMiddleware = (req, res, next) => {
  const clientIP = getClientIP(req);
  
  // Check if client IP is in whitelist
  const isAllowed = WHITELIST.some(ip => isIPInSubnet(clientIP, ip));
  
  if (isAllowed) {
    next();
  } else {
    res.status(403).json({ 
      message: 'Access denied. Your IP address is not authorized.',
    });
  }
};

module.exports = ipWhitelistMiddleware;
