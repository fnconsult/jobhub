---
kind: tutorial
audience: administrator
topic: contenu
title: Turn an unanswered question into an article
synonyms: [write a help article, article written, fill a help gap, add a synonym, help article, help editor, dismiss a question]
---
An unanswered question shows a gap in the help. Filling it means writing an article or adding a synonym to an existing one. You need the Help editor or Super-admin role.

1. Open Unanswered questions (Content menu). The most asked come first; filter if needed with « Filter by audience », « Filter by page » and « Filter by language ».
2. Read the question and « The AI's answer ». It is raw material, never an article: check each fact and each label in the current interface.
3. First look for a close article, in the help (/aide) or in the back office help. If it already answers, add the question's words to its synonyms.
4. Otherwise, write the article in French first, which is authoritative, then in English, with one audience and one topic, using « vous », quoting labels word for word. Articles live in the repository, under `packages/help/articles/`.
5. Put the change up for review. A person reviews and merges it: no article is served before that merge.
6. Back on the question, click « Article written ». For a question that is not a gap in the help, click « Dismiss ».

The question is kept redacted, without the name of whoever asked it, then erased 30 days after it was marked.
