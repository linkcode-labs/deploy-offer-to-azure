# App page standard

Every application in this repository has a page with the same sections in the same order, so a customer can compare
apps and find the same information in the same place. The page (`apps/<app>/README.md`) is generated; the app
repository supplies the content in a **listing** folder, and `validate` rejects a listing that does not follow this
standard.

## Where the content lives

In the app repository (`com-<app>`), next to the Bicep that it describes:

```text
deploy/azure/
  main.bicep
  createUiDefinition.json
  listing/
    app.json            texts and the resource list (schema below)
    architecture.mmd    Mermaid diagram of what the template deploys
    media/              optional screenshots: png, jpg, svg, gif, webp; up to 1 MB each
```

Start from [`templates/listing/`](../templates/listing/). On release, the publish job copies `listing/` to
`apps/<app>/` here and adds the release notes to the version folder. See [publishing.md](publishing.md).

## Page layout

| # | Section | Source |
|---|---|---|
| 1 | Title, summary, Deploy to Azure button, version | `title`, `summary`, newest version |
| 2 | Overview, Features | `description`, `features` |
| 3 | Screenshots (if any) | `screenshots`, `media/` |
| 4 | Architecture: text, diagram, table of resources | `architecture.description`, `architecture.mmd`, `architecture.resources` |
| 5 | Requirements | `requirements` |
| 6 | Cost | `cost` |
| 7 | Security and data | `security` |
| 8 | Deployment parameters | parameters of the newest `azuredeploy.json` with `metadata.description` |
| 9 | After deployment | outputs of the newest `azuredeploy.json`, then `afterDeployment` steps |
| 10 | Support (if any) | `support` |
| 11 | Versions: button, files and release notes per version | version folders, `release-notes.md` |

The main README lists every app with `title`, `summary`, the newest version and its button.

## `app.json`

| Key | Required | Content |
|---|---|---|
| `title` | yes | Product name. |
| `summary` | yes | One line, at most 160 characters: what it does and for whom. Shown in the app list. |
| `description` | yes | Markdown, two or three short paragraphs: the problem, what the app does, who uses it. |
| `features` | yes | List of short sentences, one capability each. |
| `screenshots` | no | List of `{ "file": "media/<name>", "caption": "..." }`. |
| `architecture.description` | yes | Markdown: how a request flows, where data is stored, what the app talks to outside the resource group. |
| `architecture.resources` | yes | List of `{ "name", "type", "purpose", "sku" }` for everything the template creates; `type` is the Azure resource type (`Microsoft.App/containerApps`); `sku` is optional. |
| `requirements` | yes | Roles, quotas, region limits, model access, keys from LinkCode. |
| `cost` | yes | Markdown: idle and typical monthly cost at list prices, what drives it. |
| `security` | yes | Markdown: data location, identities, secrets, network exposure, what leaves the subscription. |
| `afterDeployment` | no | Numbered steps after the deployment finishes. |
| `support` | no | `homepage`, `docs`, `marketplaceUrl` (https URLs), `contact` (https or `mailto:`). |

Unknown keys are rejected, so a typo does not silently drop a section.

## `architecture.mmd`

- Mermaid source only (no ``` fences); GitHub renders it on the page.
- Start with `flowchart LR` or `flowchart TB` (also accepted: `graph`, `architecture-beta`, `C4*`).
- Show what the template creates, grouped in a `subgraph` for the resource group (and the Container Apps
  environment), plus the external things the app talks to (users, LinkCode registry, model endpoint, identity
  provider). Label edges with the protocol or purpose.
- Keep it to one screen. Detailed internals belong in the app repository, not on the public page.
- Preview it at [mermaid.live](https://mermaid.live) or in any GitHub Markdown preview.

## In the template

- Every parameter and every output needs a description (`@description('...')` in Bicep, `metadata.description` in
  ARM); `validate` fails without it. These become the parameter and output tables.
- Secure parameters (`@secure()`) never have a default value.

## Release notes

Optional `apps/<app>/<version>/release-notes.md`, written by the publish job from the GitHub release notes of the
app's tag. Customer-facing: what changed for them, not commit messages.
