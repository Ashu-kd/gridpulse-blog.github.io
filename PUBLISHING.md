# Publishing articles on GridPulse

Your site is a static GitHub Pages site. Articles are plain **Markdown files in `_posts/`**.
Every time a file is committed, GitHub Pages (Jekyll) rebuilds the site in about a minute and the article appears:

* as its own page — `https://<your-site>/articles/YYYY/MM/slug/` (shareable, with X/LinkedIn preview cards),
* on the home page article grid (via the generated `articles.json`),
* in the RSS feed — `/feed.xml`, and in `sitemap.xml` for search engines.

Nothing is stored in the browser any more, so what you publish is what every visitor sees, and every change is versioned in Git.

```
_posts/2026-11-21-lcc-hvdc-current-control-and-mode-shift.md   ← one file per article
        └─ date ─┘ └──────────── slug (becomes the URL) ────────┘
```

---

## 1. One-time setup (≈10 minutes)

1. **Upload everything in this folder** to your GitHub Pages repository (keep the folder structure; the folders starting with `_` matter).
   Do **not** add a file called `.nojekyll` — Jekyll must run.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site is configured for the repository **`Ashu-kd/gridpulse-blog.github.io`** → https://ashu-kd.github.io/gridpulse-blog.github.io/ . If you ever move it, update `baseurl`/`url` in `_config.yml` and `repo`, `site_url`, `public_folder` in `admin/config.yml`.
4. Create a token for the Author Studio:
   GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   * Repository access: **Only select repositories** → your site repository
   * Permissions → Repository permissions → **Contents: Read and write**
   * Expiration: up to you (e.g. 1 year). Keep the token private; anyone with it can edit the repository.
5. Open **`https://ashu-kd.github.io/gridpulse-blog.github.io/admin/`**, choose **Sign In with Token** and paste the token. The browser remembers it.

---

## 2. Three ways to publish

### A. Author Studio (recommended — works on desktop and phone)
`/admin/` runs **Sveltia CMS** (open-source, Git-based). Click **Articles → New**, fill in Title, Topic, Summary and Body, upload images by drag-and-drop, then **Save**. Sveltia commits the file to `_posts/`; the article is live after the Pages build (watch **Actions → pages build and deployment** in the repo).
The *Author Portal* link in the site footer (and `Ctrl + Shift + A`) now opens this studio.

### B. GitHub website / GitHub mobile app
Repository → `_posts/` → **Add file → Create new file** → name it `YYYY-MM-DD-your-slug.md` → paste the template below → **Commit changes**.

### C. Git on your computer
```bash
git clone https://github.com/Ashu-kd/gridpulse-blog.github.io.git
cd gridpulse-blog.github.io
# create _posts/2026-12-01-commutation-failure-explained.md
git add _posts && git commit -m "Article: commutation failure explained" && git push
```
Optional local preview: install Ruby + Jekyll, add a `Gemfile` containing `gem "github-pages", group: :jekyll_plugins`, then run `bundle exec jekyll serve` and open http://localhost:4000.

---

## 3. Article template

```markdown
---
title: "Commutation failure in LCC-HVDC: a practical explanation"
date: 2026-12-01 09:00:00 +0530
topic: HVDC                      # HVDC | Protection | Grid Modeling | Open Source | Industry News
description: "One or two sentences — used on the card, in Google and in X/LinkedIn previews."
standard: CIGRE TB 754           # optional reference tag shown on the card
tags: [LCC-HVDC, commutation failure]
image: /assets/img/articles/cf-cover.png   # path inside the site; the layout adds /gridpulse-blog.github.io   # optional cover image
published: true                  # false = keep as draft
---

Intro paragraph…

## Section heading

Inline maths $$\gamma = \beta - \mu$$ and display maths:

$$
\cos\gamma = \cos\beta + \frac{2 d_x I_d}{k}
$$

{% include sim.html module="cf" caption="Try a 15 % dip with a −4° phase jump" %}
```

### Writing features

| You want | Write |
|---|---|
| Equation in a sentence | `$$V_d = V_{do}\cos\alpha$$` |
| Displayed equation | `$$` on its own line, the formula, `$$` on its own line (blank line before and after) |
| A live simulator | `{% include sim.html module="pole" %}` — modules: `pole`, `tune`, `cf`, `rpc`, `vsc`, `py` |
| A simulator in a specific state | In the Controller Lab set the sliders, press the **`</>`** button (copies the full `{% include … %}` line) and paste it |
| Image | `![alt text](/gridpulse-blog.github.io/assets/img/articles/figure.png)` (the Studio inserts this for you) |
| Code | fenced block with a language: ```` ```python ```` |
| Table | GitHub-style Markdown table |
| Draft | `published: false` |

**One gotcha:** Jekyll treats `{{` and `{%` as template code. If an equation contains `{{` (e.g. `\frac{1}{{x}}`), write it as `\frac{1}{ {x} }` or wrap that part in `{% raw %} … {% endraw %}`.

**Scheduling:** a post with a future `date` is skipped until a build runs after that time. GitHub Pages builds on every commit, so the post goes live with your next commit after that date.

---

## 4. A weekly routine that fits the site

1. Pick the week's topic (e.g. from India/global HVDC news you are already posting on X).
2. Build the scenario in the **HVDC Controller Lab**, press **`</>`** to copy the embed line.
3. Write the article in `/admin/` (or start from the template), paste the embed line, **Save**.
4. When the Pages build finishes, open the article and use **Share → X / LinkedIn**. The link preview uses the title and `description`.

---

## 5. Troubleshooting

* **Article does not appear** — check the file name (`YYYY-MM-DD-slug.md`), that the date is not in the future, `published` is not `false`, and that the latest *pages build and deployment* run in **Actions** is green.
* **Build failed** — open the failed run; the log names the file and line. Usually an unmatched `{{`/`{%` or a YAML mistake in the front matter (titles containing `:` must be in quotes).
* **Studio says "Not Found" or cannot save** — the token is missing *Contents: Read and write*, has expired, or `admin/config.yml` points to the wrong `repo`/`branch`.
* **Equations show as raw text** — use `$$…$$` (single `$` is not recognised by Jekyll's Markdown engine).
