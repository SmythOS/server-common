# @smythos/server-common

[![npm version](https://badge.fury.io/js/%40smythos%2Fserver-common.svg)](https://badge.fury.io/js/%40smythos%2Fserver-common)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reusable server components (middlewares, roles, utilities) for SmythOS server distributions. This package provides common functionality shared across SmythOS server applications, including agent loading, Swagger documentation, and utility functions.

## 🏗️ Architecture

The package follows a modular architecture with three main component types:

### 🔧 Middlewares

Express middleware functions that handle common server operations. Middlewares are reusable functions that process requests before they reach your route handlers.

### 🎭 Roles

Reusable server role classes that encapsulate specific functionality and can be mounted on Express routers. Roles provide a clean way to organize related routes and middleware into cohesive units.

### 🛠️ Utilities

Helper functions for common server operations like URL construction and data processing.

## 📚 API Reference

### Middlewares

Middlewares are Express functions that execute during the request-response cycle. This package provides several pre-built middlewares for common server operations.

#### Example: `AgentLoader`

A core middleware that demonstrates how to load agent data and configuration for incoming requests.

```typescript
import { AgentLoader } from '@smythos/server-common';
import express from 'express';

const app = express();
app.use(AgentLoader);
```

**Features:**

- Extracts agent ID from headers (`X-AGENT-ID`) or domain mapping
- Loads agent version from headers (`X-AGENT-VERSION`) or URL path
- Handles test vs production domain detection
- Loads agent configuration and billing information
- Adds agent data to request object (`req._agentData`, `req._agentSettings`)

**Request Headers:**

- `X-AGENT-ID`: Agent identifier
- `X-AGENT-VERSION`: Specific agent version (optional)
- `X-DEBUG-*`: Debug session headers for development

**Added Request Properties:**

```typescript
interface ExtendedRequest extends Request {
    _agentData: AgentData; // Complete agent configuration
    _agentSettings: AgentSettings; // Agent settings instance
    _agentVersion: string; // Resolved agent version
    _plan: PlanInfo; // Billing plan information
}
```

### Roles

Roles are classes that encapsulate related functionality and can be mounted on Express routers. Each role handles its own routing, middleware, and business logic.

#### Example: `SwaggerRole`

An example role that demonstrates how to provide Swagger UI documentation for agent APIs with authentication support.

```typescript
import { SwaggerRole } from '@smythos/server-common';
import express from 'express';

const router = express.Router();
const swaggerRole = new SwaggerRole(
    [
        /* custom middlewares */
    ],
    { staticPath: '/static/embodiment/swagger' },
);

swaggerRole.mount(router);
```

**Constructor Options:**

- `middlewares`: Array of custom Express middleware functions
- `options.staticPath`: Path to static Swagger assets (default: `/static/embodiment/swagger`)

**Features:**

- Auto-generates OpenAPI documentation from agent configuration
- Supports API key authentication when configured
- Injects debug scripts for test domains
- Customizable static asset paths

#### `BaseRole`

Abstract base class for creating custom server roles.

```typescript
import { BaseRole } from '@smythos/server-common';

class CustomRole extends BaseRole {
    constructor(middlewares, options) {
        super(middlewares, options);
    }

    async mount(router) {
        // Implement custom mounting logic
    }
}
```

### Utilities

#### `constructServerUrl(domain: string): string`

Constructs proper server URLs with correct protocol and port based on environment.

```typescript
import { constructServerUrl } from '@smythos/server-common';

const serverUrl = constructServerUrl('example.com');
// Returns: "https://example.com" (production)
// Returns: "http://example.com:3000" (development with port)
```

**Environment Variables:**

- `NODE_ENV`: Environment mode (`DEV` for development)
- `AGENT_DOMAIN_PORT`: Port for development domains
- `AGENT_DOMAIN`: Base domain for agent services

## 🚀 Usage Examples

### Basic Express Server with Middleware and Roles

```typescript
import express from 'express';
import { AgentLoader, SwaggerRole } from '@smythos/server-common';

const app = express();
const router = express.Router();

// Apply middleware (example: agent loading)
app.use(AgentLoader);

// Set up a role (example: Swagger documentation)
const swaggerRole = new SwaggerRole([], {
    staticPath: '/static/swagger',
});
swaggerRole.mount(router);

// Mount the router
app.use('/docs', router);

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
```

### Using Middleware in Your Application

```typescript
import { AgentLoader } from '@smythos/server-common';

// Apply the middleware
app.use(AgentLoader);

// Access middleware-processed data in your routes
app.use((req, res, next) => {
    // Example: Access data added by AgentLoader middleware
    const agentData = req._agentData;
    const isTestDomain = agentData.usingTestDomain;

    console.log(`Processing request for agent: ${agentData.id}`);
    console.log(`Version: ${req._agentVersion}`);
    console.log(`Test domain: ${isTestDomain}`);

    next();
});
```

### Creating Custom Roles

```typescript
import { BaseRole } from '@smythos/server-common';
import express from 'express';

// Example: Custom health check role
class HealthCheckRole extends BaseRole {
    async mount(router: express.Router) {
        const middlewares = [...this.middlewares];

        router.get('/health', middlewares, (req, res) => {
            res.json({
                status: 'healthy',
                agent: req._agentData?.id,
                version: req._agentVersion,
                timestamp: new Date().toISOString(),
            });
        });
    }
}

// Usage
const healthRole = new HealthCheckRole([
    /* custom middlewares */
]);
healthRole.mount(router);
```

### Creating Custom Middleware

```typescript
import express from 'express';

// Example: Custom logging middleware
export function RequestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
}

// Usage
app.use(RequestLogger);
```

## 🔧 Environment Configuration

The package relies on several environment variables:

```bash
# Required
NODE_ENV=DEV|PROD                    # Environment mode
AGENT_DOMAIN=your-agent-domain.com   # Base agent domain
PROD_AGENT_DOMAIN=prod-domain.com    # Production agent domain

# Optional
AGENT_DOMAIN_PORT=3000               # Development port
UI_SERVER=https://ui.example.com     # UI server for debug scripts
```

## 🏗️ Development

### Building the Package

```bash
# Install dependencies
pnpm install

# Build the package
pnpm run build

# Clean build artifacts
pnpm run clean
```

### Build Process

1. **ctix**: Generates barrel exports (`src/index.ts`)
2. **Rollup**: Bundles TypeScript source with esbuild
3. **TypeScript**: Generates type definitions

### Project Structure

```
src/
├── index.ts                 # Generated barrel exports
├── middlewares/
│   └── AgentLoader.mw.ts   # Agent loading middleware
├── roles/
│   ├── Base.role.ts        # Base role class
│   └── swagger/
│       └── Swagger.role.ts # Swagger documentation role
└── utils/
    └── url.utils.ts        # URL utility functions
```

## 🔗 Dependencies

### Runtime Dependencies

- `@smythos/sdk`: SmythOS SDK for core functionality
- `swagger-ui-express`: Swagger UI middleware
- `dotenv`: Environment variable loading

### Development Dependencies

- `rollup`: Module bundler
- `esbuild`: Fast TypeScript compiler
- `ctix`: Barrel file generator

## 📝 Version History

See [CHANGELOG](./CHANGELOG.md) for detailed version history.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:

- 📧 Email: [support@smythos.com](mailto:support@smythos.com)
- 🐛 Issues: [GitHub Issues](https://github.com/SmythOS/server-common/issues)
- 📖 Documentation: [SmythOS Docs](https://docs.smythos.com)

---

**Made with ❤️ by the SmythOS Team**
