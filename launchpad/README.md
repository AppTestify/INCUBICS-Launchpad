# Deploying LaunchPad-INCUBICS

LaunchPad-INCUBICS is a rebranded build of the open-source [Huly Platform](https://github.com/hcengineering/platform)
(release `v0.7.432`, Eclipse Public License 2.0). This folder holds what is needed to run it at
`https://launchpad.incubics.com`.

Only two services carry branding and are built from this repository: the web front end and the
account service (which sends invitation and password e-mails). Everything else runs the unmodified
upstream images of the same release.

| Path | Purpose |
| --- | --- |
| `build-images.sh` | Builds `launchpad-front` and `launchpad-account` images |
| `../.github/workflows/launchpad-images.yml` | Runs that build on GitHub and pushes to `ghcr.io/apptestify` |
| `server/` | Self-contained Docker Compose stack and installer for the server |

## Server requirements

- Linux with Docker Engine and the compose plugin
- At least 4 GB of *free* memory (8 GB recommended) and 30 GB of disk
- DNS `A` record for `launchpad.incubics.com` pointing at the server

## 1. Publish the images

Pushing to this repository runs the **LaunchPad images** workflow, which publishes
`ghcr.io/apptestify/launchpad-front` and `ghcr.io/apptestify/launchpad-account`. It can also be
started by hand from the Actions tab. To build elsewhere, run `./launchpad/build-images.sh` on a
machine with Node.js 20+, Docker and about 8 GB of free memory, then `docker push` both images.

If the packages are private, log in once on the server with a GitHub token that has
`read:packages`:

```bash
docker login ghcr.io -u <github-user>
```

## 2. Install on the server

Copy the `server/` folder to the server (for example to `/opt/launchpad`) and run:

```bash
cd /opt/launchpad
```

```bash
./install.sh --check
```

```bash
./install.sh
```

`--check` changes nothing; it reports free memory, who owns ports 80/443 and the containers already
running. The installer is written for a server that hosts other applications:

- everything runs in its own compose project (`launchpad`), network and volumes
- no other container, nginx or service is stopped, restarted or reconfigured
- the only thing published on the host is this stack's **own nginx container**
- it refuses to start when less than 4 GB of memory is free, so it cannot starve the other apps
- secrets are generated once into `server/.env` and never overwritten

How the stack's nginx is exposed depends on what the installer finds:

| Situation | What happens |
| --- | --- |
| Ports 80 and 443 are free | LaunchPad's nginx binds them, obtains a Let's Encrypt certificate and renews it by itself |
| Another program already owns 80/443 | LaunchPad's nginx listens on `127.0.0.1:18087` only. The installer prints one new virtual-host file to add to the existing proxy so it forwards `launchpad.incubics.com` there |

Only one program can own port 443 on a single IP address, so in the second case a forwarding entry
in the existing proxy is unavoidable. It is a new file; no existing site is edited.

Re-running `./install.sh` later pulls newer images and restarts only the LaunchPad containers.

## Keeping the site out of search engines

Three layers are in place:

1. The front server sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on every response
   (`server/front/src/index.ts`; set `ALLOW_SEARCH_INDEXING=true` to turn it off).
2. The HTML page carries `<meta name="robots" content="noindex, nofollow, noarchive">`.
3. LaunchPad's nginx adds the same header to every proxied path (`server/nginx/routes.inc`).

`robots.txt` deliberately does not block crawling. A crawler must be able to fetch a page to see
`noindex`; a blocked URL can still be listed (without content) if another site links to it.

This stops the site from showing in results. It does not stop people from opening the URL. For
that, restrict access in nginx (IP allow-list or VPN) and turn off self sign-up by adding
`DISABLE_SIGNUP=true` to the `account` and `front` services in `server/compose.yml`.

## Where the branding lives

| What | Where |
| --- | --- |
| Page title, favicon defaults | `dev/prod/src/index.ejs`, `dev/prod/src/platform.ts` |
| Per-host title, icons, languages | `dev/prod/public/branding.json` |
| Favicons, app icons, web manifest | `dev/prod/public/launchpad/` |
| Logo on sign-in and onboarding pages | `plugins/login-resources/img/`, `plugins/onboard-resources/img/` |
| Product name in UI text and e-mails | `**/lang/*.json` |

The desktop app (`desktop/`) and optional add-on services (mail, AI bot, GitHub, and others) are
not rebranded.
