import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const apiHost = process.env.VIOLOOP_HOST || env.VIOLOOP_HOST || "127.0.0.1";
	const apiPort = Number(process.env.VIOLOOP_PORT || env.VIOLOOP_PORT || 3000);

	if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
		throw new Error("VIOLOOP_PORT must be an integer between 1 and 65535.");
	}

	return {
		plugins: [react(), tailwindcss()],
		server: {
			port: 5173,
			proxy: {
				"/api": `http://${apiHost}:${apiPort}`,
			},
		},
	};
});
