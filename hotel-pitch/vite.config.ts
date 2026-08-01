import {defineConfig} from "vite";import {cloudflare} from "@cloudflare/vite-plugin";import {vinext} from "vinext/vite";export default defineConfig({plugins:[vinext(),cloudflare()]});
