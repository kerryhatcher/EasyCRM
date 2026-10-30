---
name: EasyCRM
description: A calm address book for people, organizations, and conversations.
colors:
  primary: "#0a4f52"
  primary-dark: "#083e41"
  ink: "#162a32"
  muted: "#61737a"
  background: "#f8faf9"
  surface: "#ffffff"
  border: "#dce5e4"
  selection: "#eaf4f3"
typography:
  heading:
    fontFamily: "Newsreader, Georgia, serif"
    fontWeight: 600
    lineHeight: 1.1
  body:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
rounded:
  control: "7px"
  panel: "12px"
spacing:
  tight: "8px"
  regular: "16px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  record-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink}"
---

# Design System: EasyCRM

## Overview

**Creative North Star: The Correspondence Register.** A clear record sheet is the visual model: a stable index at left, the selected person or organization in focus, and a dated account of interactions below. The interface favors task clarity and concise labels. The deep teal marks the current place and the action to take.

## Colors

White record surfaces sit against a very pale cool background. Deep teal is reserved for navigation selection, links, and primary actions. Fine cool borders divide information without wrapping every section in a card.

## Typography

DM Sans carries navigation, forms, and data. Newsreader is reserved for the record name and major sign-in/form titles. Both remain legible at fixed UI sizes.

## Layout

Desktop uses a 206px navigation rail, a 320–400px list, and a flexible detail pane. Tablet narrows the rail to icons. On phones the navigation becomes a horizontal strip and the detail pane opens over the list with a Back control. Details and connections stack as space shrinks.

## Elevation & Depth

Most divisions use 1px borders. Only the sign-in panel and transient toast have soft, offset shadows.

## Shapes

Controls use restrained 6–7px corners. The avatar is circular. The main record and list surfaces remain square and flush.

## Components

Primary buttons carry the teal fill. Secondary actions have a pale border or text treatment. Record rows use a teal-tinted selected state, and input focus adds a visible teal ring. Activity is a ruled chronological list.

## Do's and Don'ts

- Do keep contact details, relationships, and history visible without switching tools.
- Do use the same form and button language for contacts and organizations.
- Don't add metrics, calendar controls, stars, or other data the schema cannot support.
