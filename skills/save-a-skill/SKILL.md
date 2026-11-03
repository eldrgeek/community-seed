---
name: save-a-skill
version: 1
author: SOMA (Mike Wolf and Claude)
description: How an AI keeps a skill it was given, so it still has it in the next conversation, in ChatGPT (a project file or project instructions) or Claude (a skill or project knowledge). Use after your person approves adopting a skill, or says "remember how to do this", "keep this skill". Not before your person has said yes.
---

# Save a skill

A skill you read in one conversation is gone in the next unless it is saved where you load it. This skill says where to save it. You save it only after your person has said yes to adopting it.

## First, ask

Tell your person in one or two sentences what the skill would have you do, and who offered it. Ask whether to keep it. If they say no, stop.

## ChatGPT

The best place is a project, because a project's files and instructions load in every chat inside it.

1. Ask your person which project to keep it in. If they have none, they can make one from "Projects" in the sidebar.
2. Give your person the skill's full text as a file named `<skill name>.md`. Ask them to add it to the project with "Add files".
3. If the skill is short and should apply to every chat, your person can paste one line into the project's instructions instead: "When <the skill's 'Use when' text>, follow the file <skill name>.md." Opening a project's instructions: the project's menu, then "Project settings".
4. Your person presses Save. Project settings show Save only after an edit.

You cannot add the file yourself. Your person makes every click.

## Claude

1. In the Claude app, your person can add a skill in Settings, in the Skills section. They upload a zip of a folder containing `SKILL.md`. Menu names change between app versions, so if they cannot find it, ask them to search Settings for "Skills".
2. In a Claude project, your person can instead add `SKILL.md` to the project's knowledge.
3. In Claude Code, the skill goes in a folder `~/.claude/skills/<skill name>/SKILL.md`. Claude Code can write that file itself after your person says yes.

## Keep the version

Write down the skill's name and version, and where you saved it, in your reply to your person. If the same skill arrives later with a higher version, tell your person and offer to replace the saved copy.

## Check

You did it right when, in a new conversation, you can find and follow the skill without anyone pasting it again, and your person approved keeping it.
