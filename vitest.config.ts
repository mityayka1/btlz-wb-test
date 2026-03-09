import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: "node",
        testTimeout: 15_000,
        exclude: ["node_modules", "dist", "src/**/*.e2e.test.ts"],
    },
});
