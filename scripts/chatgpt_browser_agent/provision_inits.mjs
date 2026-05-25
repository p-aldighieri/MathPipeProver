// Prepend an authoritative "PROVISIONED" header (project URL + CDP port + launch cmd) to each INIT.md.
import { readFileSync, writeFileSync } from 'fs';
const BASE = 'C:/Users/dep89/OneDrive/Economia/Projetos/Ai4Science';
const P = [
  ['01_straight_jacket_auction',            'https://chatgpt.com/g/g-p-6a14d825c06c8191b899527f56a08686/project', 9231],
  ['02_rochet_chone_3d',                    'https://chatgpt.com/g/g-p-6a14d850c4748191977875f42b16a24c/project', 9232],
  ['03_revelation_principle_info_acquisition','https://chatgpt.com/g/g-p-6a14d86210d08191a507ed0004388413/project', 9233],
  ['04_dynamic_persuasion_controlled_markov','https://chatgpt.com/g/g-p-6a14d873c2f881918e3913b39e6582d2/project', 9234],
  ['05_ddc_semiparametric_efficiency',      'https://chatgpt.com/g/g-p-6a14d887c4e08191a1b78c9a2b62572e/project', 9235],
  ['06_couples_matching_threshold',         'https://chatgpt.com/g/g-p-6a14d89978308191910198345e96758b/project', 9236],
  ['07_gross_substitutes_five_good',        'https://chatgpt.com/g/g-p-6a14d8ab25a48191a2377b4d3cfc9800/project', 9237],
  ['08_limited_commitment_dynamic_md',      'https://chatgpt.com/g/g-p-6a14d8bc9f5481919faa4648ee7c15b1/project', 9238],
  ['09_multi_item_border_polytope',         'https://chatgpt.com/g/g-p-6a14d8ce59ac8191980b67bcfc41908a/project', 9239],
  ['10_global_games_endogenous_info',       'https://chatgpt.com/g/g-p-6a14d8e019d481918aae36a15d168c41/project', 9240],
];
const MARK = '<!-- PROVISIONED-HEADER -->';
for (const [folder, url, port] of P) {
  const f = `${BASE}/${folder}/INIT.md`;
  let body = readFileSync(f, 'utf-8');
  if (body.includes(MARK)) { console.log(`skip (already provisioned): ${folder}`); continue; }
  const profile = `C:/Users/dep89/.mathpipeprover/chrome-mpp-${folder.slice(0,2)}-profile`;
  const header = `${MARK}
> ## ✅ PROVISIONED 2026-05-25 — use these values (they override any \`TODO\` later in this file)
>
> - **ChatGPT project:** ${url}
>   - Memory = **Project-only** (verified at creation; this setting is immutable).
> - **CDP port:** \`${port}\`  ·  **Chrome profile:** \`${profile}\`
> - **Launch the browser at session start** (run from the Bash tool):
>   \`\`\`bash
>   "/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=${port} --user-data-dir="${profile}" --no-first-run --no-default-browser-check "${url}" &
>   \`\`\`
>   If it opens the ChatGPT **login** page, ask the user to log in once (it then persists in this profile). Do **not** reuse ports 9222 / 9227 / 9228 / 9230 (other live runs).
> - **Durable sources (do when ready):** upload the PDFs in \`./sources/\` + \`README.md\` to the project's **Sources** tab — script: \`/MathPipeProver/scripts/chatgpt_browser_agent/cdp_add_source.mjs --project-url "${url}" --port ${port} <files>\`.
> - **TARGET_FILE** = \`README.md\` (the problem brief, in this folder).

`;
  writeFileSync(f, header + body, 'utf-8');
  console.log(`provisioned: ${folder}  ->  port ${port}`);
}
console.log('done.');
