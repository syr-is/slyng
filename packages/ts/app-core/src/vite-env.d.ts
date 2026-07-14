/// <reference types="vite/client" />

// app-core is consumed by Vite apps that replace `import.meta.env.*` at build
// time. This reference brings Vite's ambient `import.meta.env` typings into the
// package's own type-check (the standalone tsconfig doesn't otherwise include
// them), so `import.meta.env.DEV` guards type-check here as they do in the apps.
