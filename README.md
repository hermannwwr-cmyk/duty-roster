# Duty Roster

A web app for a daily duty rotation. Everyone takes turns as Primary, Secondary 1, Secondary 2 and so on. Weekends and public holidays have no duty, and people sign in to add their leave, which takes them off the roster for those days.

- **Website:** plain HTML and JavaScript. It runs on GitHub Pages with no build step.
- **Database and logins:** [Supabase](https://supabase.com), which provides Postgres and email/password accounts on its free plan.
- **Demo mode:** until you connect Supabase, the app runs with five example people and saves to your browser only.

## How the rotation works

- Active team members stand in a fixed order, which an admin can change.
- Only working days count: Monday to Friday, minus public holidays.
- Each working day everyone available gets a role. The person whose turn it is becomes **Primary**, the next is **Secondary 1**, and so on. The number of roles changes with how many people are in that day.
- The next working day, the person after today's Primary becomes Primary.
- Anyone on leave is left out for the day and the others move up. If it was their turn as Primary, they skip it rather than someone doing Primary twice in a row.
- The rotation counts from the **rotation start** date set by an admin.
- The roster is worked out from these rules every time it's shown. Adding leave, changing the order or adding a holiday updates every day from then on.

The rules are in `src/schedule.js`, with tests in `tests/schedule.test.mjs`.

## Set up Supabase (about 10 minutes)

1. Create a free account at [supabase.com](https://supabase.com) and a **New project**. Pick the Singapore region if it's offered.
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, and click **Run**. This creates the tables, the security rules and the 2026–2027 Singapore public holidays.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key into `config.js`.
4. Open **Authentication > URL Configuration** and set **Site URL** to where the app will live, for example `https://<your-github-name>.github.io/duty-roster/`. Confirmation emails link back to this address.
5. Open the app and **create an account**. The first person to sign up becomes the admin. Everyone else then creates their own account and appears in the rotation order.

The anon key is safe to publish. The database's row level security only lets signed-in people read the roster, lets each person change only their own leave and name, and keeps the order, holidays and settings for admins.

By default Supabase asks new users to confirm their email. To skip that for a small team, turn off **Confirm email** under **Authentication > Providers > Email**.

## Put it online with GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository open **Settings > Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
3. The app is live at `https://<your-github-name>.github.io/<repo-name>/` within a minute or two.

## Run it on your computer

```bash
npm start
```

Then open http://localhost:5173. Run the rotation tests with:

```bash
npm test
```

## Using the app

- **Roster:** your role today, then each working day of the month with everyone's role. Public holidays are listed with their name.
- **Leave:** add a date range to come off the roster, and see who else is away. Admins can add leave for anyone.
- **Team:** the rotation order. Admins can reorder people, mark someone inactive, give admin access, set the rotation start date, and add or remove public holidays.

## Public holidays

Singapore public holidays for 2026 and 2027 come from the Ministry of Manpower dataset on [data.gov.sg](https://data.gov.sg) (collection 691). When later years are announced, an admin adds them in the **Team** tab. No code change is needed.
