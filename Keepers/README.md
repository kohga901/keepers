# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

### Optional local AI key for development

To avoid entering a test key in the app during local development, add the key to the existing
ignored `.env` file beside `package.json`, or create an ignored `.env.local` file there:

```dotenv
EXPO_PUBLIC_KEEPERS_GOOGLE_AI_API_KEY=your_test_key
# EXPO_PUBLIC_KEEPERS_OPENAI_API_KEY=your_test_key
# EXPO_PUBLIC_KEEPERS_ANTHROPIC_API_KEY=your_test_key
```

Restart Expo with `npx expo start --clear`, select that provider in Settings, and the app will
show that it is using the development key. The override is disabled when `__DEV__` is false.

Expo embeds every `EXPO_PUBLIC_*` value in the client bundle. Use only a short-lived, restricted
development key with a strict spending limit. Never commit `.env.local`, configure these variables
in EAS, or include them in a preview or production build. Production users continue to supply their
own keys, which the native app stores in encrypted device storage.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
