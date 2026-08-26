# @respondkit/api-client

An SSR-safe, typed HTTP client for the RespondKit customer API.

```sh
pnpm add @respondkit/api-client
```

```ts
import { createRespondKitClient } from "@respondkit/api-client";

const client = createRespondKitClient({
  baseUrl: "https://api.respondkit.dev",
});
```

Most React applications should install [`@respondkit/react`](https://www.npmjs.com/package/@respondkit/react), which uses this client internally.
