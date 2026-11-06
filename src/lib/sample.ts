import { newProject, newStep, uid } from "./model";
import { putAsset, saveProject } from "./db";
function screenshot(page: number) {
  const c = document.createElement("canvas");
  c.width = 1440;
  c.height = 900;
  const x = c.getContext("2d")!;
  const rect = (
    a: number,
    b: number,
    w: number,
    h: number,
    color: string,
    r = 0,
  ) => {
    x.fillStyle = color;
    x.beginPath();
    x.roundRect(a, b, w, h, r);
    x.fill();
  };
  const text = (
    t: string,
    a: number,
    b: number,
    size = 16,
    color = "#52645a",
    bold = false,
  ) => {
    x.fillStyle = color;
    x.font = `${bold ? "600" : "400"} ${size}px Arial`;
    x.fillText(t, a, b);
  };
  rect(0, 0, 1440, 900, "#f6f8f4");
  rect(0, 0, 235, 900, "#eaf0e7");
  text("◈  meadow", 28, 48, 28, "#203d2d", true);
  text("WORKSPACE", 28, 112, 11);
  ["Overview", "Projects", "Inbox", "Team", "Settings"].forEach((s, i) => {
    if (i === page % 3) rect(14, 137 + i * 48, 207, 40, "#d4e3cc", 8);
    text(
      ["▦", "▤", "▧", "♧", "⚙"][i] + "   " + s,
      30,
      163 + i * 48,
      16,
      "#36523f",
      i === page % 3,
    );
  });
  text("Your space to do good work.", 28, 851, 12);
  rect(235, 0, 1205, 78, "#fff");
  text(
    "Workspace   /   " + ["Overview", "Projects", "Inbox"][page % 3],
    275,
    46,
    15,
  );
  text("Search your workspace…", 1000, 46, 14, "#9aa49b");
  rect(1350, 22, 34, 34, "#d9e6c1", 17);
  text("J", 1362, 45, 15, "#375039");
  text(
    [
      "A little clarity. A lot of progress.",
      "Make room for your next big idea.",
      "Great work starts with a conversation.",
    ][page % 3],
    285,
    150,
    30,
    "#213f2e",
    true,
  );
  text("Monday, June 16  ·  Let’s make something good.", 285, 183, 15);
  rect(1210, 123, 164, 44, "#284b36", 8);
  text("+  New project", 1233, 151, 15, "#fff");
  const cards = ["Active projects", "Tasks completed", "Team members"];
  cards.forEach((t, i) => {
    rect(285 + i * 369, 224, 345, 143, "#fff", 12);
    text(t, 308 + i * 369, 257, 14);
    text(["12", "86", "8"][i], 308 + i * 369, 310, 39, "#244532", true);
    text(
      ["↑ 3 this month", "↑ 24 this week", "All working together"][i],
      308 + i * 369,
      342,
      12,
      "#6b865c",
    );
  });
  text("Your projects", 285, 424, 23, "#213f2e", true);
  text("A home for everything you’re building.", 285, 452, 14);
  rect(285, 481, 1083, 337, "#fff", 12);
  ["PROJECT", "STATUS", "TEAM", "DUE DATE"].forEach((t, i) =>
    text(t, [309, 767, 1000, 1190][i], 519, 11),
  );
  [
    "Website refresh",
    "Summer campaign",
    "Product launch",
    "Customer stories",
  ].forEach((t, i) => {
    rect(305, 545 + i * 63, 1041, 1, "#eef0eb");
    rect(
      309,
      563 + i * 63,
      32,
      32,
      ["#eadac6", "#d9e8ce", "#ded9ef", "#d2e5e8"][i],
      8,
    );
    text(t, 358, 585 + i * 63, 16, "#2b4633", true);
    rect(767, 564 + i * 63, 101, 27, i === 1 ? "#f3e8c9" : "#e4eedc", 13);
    text(i === 1 ? "In review" : "In progress", 781, 582 + i * 63, 12);
    for (let j = 0; j < 3; j++)
      rect(
        1000 + j * 23,
        564 + i * 63,
        27,
        27,
        ["#d5dec7", "#e7cdbb", "#d7d0e4"][j],
        14,
      );
    text(["Jun 24", "Jun 28", "Jul 02", "Jul 08"][i], 1190, 584 + i * 63, 14);
  });
  return new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
}
export async function createSample() {
  const p = newProject("A little tour of Meadow");
  p.description =
    "An example of what you can make. Click through, make it your own, then take it anywhere.";
  p.background = "#dce5d6";
  const intro = newStep();
  intro.title = "Good work needs a little space.";
  intro.body =
    "Meet Meadow. A calmer place to bring your team, projects, and next big ideas together.";
  p.steps.push(intro);
  for (let i = 0; i < 3; i++) {
    const s = newStep("image");
    s.title = [
      "Your whole day, at a glance",
      "A home for your next big idea",
      "Keep everyone in the loop",
    ][i];
    s.body = [
      "See what matters. Your projects, progress, and people in one clear view.",
      "Start something new, or pick up right where you left off.",
      "Less chasing updates. More moving forward together.",
    ][i];
    s.assetId = uid();
    s.hotspots = [
      {
        id: uid(),
        x: [9, 89.7, 9][i],
        y: [23.5, 16.2, 29][i],
        label: ["Explore projects", "Create a project", "Explore your inbox"][
          i
        ],
        target: "next",
      },
    ];
    await putAsset({
      id: s.assetId,
      projectId: p.id,
      blob: await screenshot(i),
    });
    p.steps.push(s);
  }
  const end = newStep();
  end.title = "Your story starts here.";
  end.body =
    "This is your example demo. Change the words, move a hotspot, add a chapter, and make it yours.";
  p.steps.push(end);
  await saveProject(p);
  return p;
}
