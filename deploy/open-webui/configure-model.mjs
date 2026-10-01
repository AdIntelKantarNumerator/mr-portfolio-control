// Gives Yaara her picture in Open WebUI. Run once after the first deploy, and
// again whenever yaara-model.json or her avatar changes.
//
//   OPEN_WEBUI_URL=https://<chat>.azurewebsites.net OPEN_WEBUI_TOKEN=<token> \
//     node deploy/open-webui/configure-model.mjs
//
// Why this is a step at all: DEFAULT_MODEL_METADATA (model-metadata.mjs) sets
// her description, suggested questions and switched-off capabilities from
// configuration, but Open WebUI serves a model's picture only from a model
// entry saved in its own database. So one entry is written here, for the
// model the portfolio lists, with the same metadata.
//
// OPEN_WEBUI_TOKEN is an admin's token: Settings, Account, API keys (or the
// JWT shown there). It is read from the environment and never printed. The
// same thing can be done by hand in Workspace, Models, Yaara, by uploading
// public/brand/yaara-128.png.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = (process.env.OPEN_WEBUI_URL ?? '').replace(/\/+$/, '')
const token = process.env.OPEN_WEBUI_TOKEN ?? ''
if (!base || !token) {
  console.error('Set OPEN_WEBUI_URL and OPEN_WEBUI_TOKEN (an admin token from Settings, Account).')
  process.exit(1)
}

const { DEFAULT_MODEL_METADATA } = JSON.parse(execFileSync(process.execPath, [join(here, 'model-metadata.mjs'), '--json', '--with-image'], { encoding: 'utf8' }))
const form = {
  id: 'yaara',
  // null: this entry dresses the model the portfolio lists, rather than
  // being a new model layered on top of it.
  base_model_id: null,
  name: 'Yaara',
  meta: JSON.parse(DEFAULT_MODEL_METADATA),
  params: {},
  is_active: true,
}

const call = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

let res = await call('/api/v1/models/create', form)
if (!res.ok) {
  // Already there: update it in place.
  res = await call('/api/v1/models/model/update', form)
}
const text = await res.text()
if (!res.ok) {
  console.error(`Open WebUI refused (${res.status}): ${text.slice(0, 300)}`)
  process.exit(1)
}
console.log(`Yaara's model entry is set on ${base}.`)
