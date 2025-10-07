# Welcome to your InstantDB NextJS app 👋

This is a NextJS project scaffolded with create-instant-app.

To run the development server:
`npm run dev`

To push schema changes:
`npx instant-cli push`

To pull schema changes:
`npx instant-cli pull`


Got any feedback or questions? Join our [Discord](https://discord.gg/hgVf9R6SBm)

## YouTube Search + Player

This app now provides a simple YouTube search page with an embedded player.

Setup:

- Create `./.env.local` and add your YouTube Data API key:

  ```
  YOUTUBE_API_KEY=YOUR_API_KEY_HERE
  ```

- Run the dev server: `npm run dev`

Usage:

- Open the app, enter a query, and click a result to play it.
