// Prints the two Open WebUI settings that make the chat present as Yaara:
//
//   DEFAULT_MODEL_METADATA      her description, suggested questions and
//                               switched-off capabilities, for the one model
//   DEFAULT_PROMPT_SUGGESTIONS  the questions offered on an empty chat
//
// Built from yaara-model.json. --with-image adds her picture from the
// portfolio's own avatar (public/brand/yaara-128.png) as a data URI, which only
// configure-model.mjs needs: Open WebUI serves a model's picture from its saved
// model entry, never from this setting, so the setting stays small.
//
//   node deploy/open-webui/model-metadata.mjs            KEY=value lines
//   node deploy/open-webui/model-metadata.mjs --json     {KEY: value}
//   node deploy/open-webui/model-metadata.mjs --json --with-image
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const model = JSON.parse(readFileSync(join(here, 'yaara-model.json'), 'utf8'))
const withImage = process.argv.includes('--with-image')
const avatar = withImage ? readFileSync(join(here, '..', '..', 'public', 'brand', 'yaara-128.png')).toString('base64') : null

const settings = {
  DEFAULT_MODEL_METADATA: JSON.stringify({
    ...(avatar ? { profile_image_url: `data:image/png;base64,${avatar}` } : {}),
    description: model.description,
    capabilities: model.capabilities,
    suggestion_prompts: model.suggestion_prompts,
  }),
  DEFAULT_PROMPT_SUGGESTIONS: JSON.stringify(model.suggestion_prompts),
}

if (process.argv.includes('--json')) console.log(JSON.stringify(settings))
else for (const [k, v] of Object.entries(settings)) console.log(`${k}=${v}`)
