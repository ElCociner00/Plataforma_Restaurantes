// permisos.sync.js

// Function to check permissions synchronously
function checkPermissions(user, requiredPermissions) {
    const userPermissions = user.permissions || [];
    // Check if user has all the required permissions
    return requiredPermissions.every(permission => userPermissions.includes(permission));
}

// Middleware function for permission checking
function permissionsMiddleware(requiredPermissions) {
    return function(req, res, next) {
        const user = req.user; // Assuming user info is attached to the request.
        if (checkPermissions(user, requiredPermissions)) {
            next(); // User has permissions, proceed to the next middleware
        } else {
            // Handle insufficient permissions, e.g., redirect or send error
            res.status(403).send('Forbidden: You do not have permission to access this resource.');
        }
    };
}

// Export the middleware for use in routes
module.exports = permissionsMiddleware;
