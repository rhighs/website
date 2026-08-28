# Product purpose

Publish Roberto Montalti's technical writing as small, durable IMD documents on a static website.

# Primary user

A curious technical reader opening an article on a phone or laptop, often following a direct link to one section.

# Principles

1. IMD should be visible. Use its type, page furniture, components, and outline instead of hiding them behind a legacy shell.
2. The document leads. Site navigation stays quiet and never competes with the prose.
3. Static first. Every page is readable before hydration and shared runtime assets stay cacheable.
4. Published addresses do not move. Routes and heading fragments survive visual changes.

# Success metric

A reader can recognize the IMD visual language, scan a long article through its native outline, and read the full page without waiting for JavaScript.

# Out of scope

- Does not become a portfolio landing page.
- Does not add a CMS or client-side application shell.
- Does not replace document furniture with layout-specific copies.
- Does not redesign the article content.

# Learned constraints

- **2026-08-28** - Use IMD's default typeface, `@imd/art` cover/footer furniture, and embedded outline on the website. *Why:* preserving the old SWP shell too literally hides the format that now powers the site.
- **2026-08-28** - Every post gets its own generated cover, tied to that post's subject and Roberto's ink-diffusion references. Do not repeat generic art across pages. *Why:* the artwork should add meaning and authorship, not merely decorate the shell.
- **2026-08-28** - Posts, quotes, and resources are native directory indexes. Quote pages keep the old site's plain heading-and-blockquote treatment. *Why:* the filesystem is the publishing model, and quotes should read like notes rather than feature cards.
- **2026-08-28** - Post pages show publication date, estimated reading time, and word count; the page footer reaches the viewport bottom on short pages. *Why:* articles need publication context and the shell must look finished at every content length.
- **2026-08-28** - Desktop outlines live only beside the article body, never around full-width banners; the compact mobile outline control is hidden. *Why:* the outline should support reading without snapping around artwork or becoming floating chrome.
- **2026-08-28** - Navigation and the home link never use dots or underlines; the current section changes to white without changing weight, width, baseline, or position. Content links are muted instead of blue and become white with an underline only on hover when they are external or email links. Quote pages have no visible repeated title or side rule, retain curly quotation marks, and write citations as `~ Name`. *Why:* navigation should stay quiet and stable, while prose links and quotations need their own clear grammar.
- **2026-08-28** - Home, Quotes, and Resources each carry distinct generated ink artwork, while navigation stays limited to human section names. *Why:* section identity should feel authored without turning the archive into a large framework or noisy landing page.
- **2026-08-28** - Do not place large artwork banners above page content. Keep the original document-first structure and use generated artwork only as the shared footer. *Why:* the banner overstates section identity and competes with the page; one closing image is enough.
- **2026-08-28** - The homepage uses the second layout study: `~rhighs` and the section links share one compact header row, followed by Roberto's name, a short role line, and the existing personal copy. This header stays on one line on every route and Roberto's homepage title does not wrap. *Why:* it preserves the original page structure while giving the name and navigation clearer scale.
- **2026-08-28** - The homepage fits one dynamic viewport without scrolling. Longer routes may scroll, but native scrollbar chrome stays hidden. *Why:* the homepage is a single composed introduction; browser scrollbar furniture is visual noise across the site.
- **2026-08-28** - Source Code Pro is the only monospace family for code and monospaced interface labels. *Why:* the previous mono face felt wrong for the site's voice, and code and shell furniture should share one deliberate family.
- **2026-08-28** - Article blockquotes use full-contrast prose and reset paragraph margins so the side rule hugs and vertically centers on the text. *Why:* dim quotation text and a rule extending beyond its content make quoted passages look disabled and misaligned.
- **2026-08-28** - Quote pages use the `quiet wide` study: a large italic quotation with open curly marks and `~ Name` attribution, followed by Roberto's commentary as ordinary prose with a clear spacing break. *Why:* the quotation gets a distinct voice without turning the page into a card, while commentary remains unmistakably Roberto's.
