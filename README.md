# MapMind

Explore OpenStreetMap through conversation. Ask for places, roads, or nearby groups; see the results on an interactive map and click names in the answer to find them.

Built with SvelteKit, Leaflet, Qwen, and the Overpass API for VT Hacks 2026.

## Run locally

```sh
npm install
cp .env.example .env
```

Set `OPENWEBUI_API_KEY` in `.env`, then start the app:

```sh
npm run dev
```

## Docker

```sh
docker compose up --build -d
```

Open `http://localhost:3000`. For deployment, set `ORIGIN` in `.env` to your public URL.

## Checks

```sh
npm run check
npm test
npm run build
```

## License

MapMind's original source code is licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-only). Third-party dependencies and datasets retain their respective licenses.

## Credits

Built by Brian Ding and Advay Iyer.<br>
Uses [OverpassNL](https://github.com/raphael-sch/OverpassNL) from [Staniek et al., Text-to-OverpassQL (TACL 2024)](https://aclanthology.org/2024.tacl-1.31/).<br>
Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).<br>
We thank the https://overpass-turbo.eu/ community and Martin Raifer<br>
We used AI tools to help with code generation, debugging, and development.
