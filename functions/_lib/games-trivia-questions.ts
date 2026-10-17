import type { TriviaDifficulty } from "../../lib/games-trivia";

export type TriviaQuestion = {
  id: string;
  difficulty: TriviaDifficulty;
  prompt: string;
  choices: readonly [string, string, string, string];
  answer: number;
};

// Original DZN question bank. Answers never leave the server runtime.
export const TRIVIA_QUESTIONS: readonly TriviaQuestion[] = [
  { id: "r01", difficulty: "recruit", prompt: "Which item is primarily used to stop bleeding?", choices: ["Bandage", "Compass", "Battery", "Lockpick"], answer: 0 },
  { id: "r02", difficulty: "recruit", prompt: "What does a compass help a survivor determine?", choices: ["Direction", "Temperature", "Health", "Noise"], answer: 0 },
  { id: "r03", difficulty: "recruit", prompt: "Which condition is reduced by drinking clean water?", choices: ["Thirst", "Bleeding", "Shock", "A broken leg"], answer: 0 },
  { id: "r04", difficulty: "recruit", prompt: "What should be checked before eating an unknown food item?", choices: ["Its condition", "Its colour only", "The server name", "The compass bearing"], answer: 0 },
  { id: "r05", difficulty: "recruit", prompt: "Which light source can be carried in one hand?", choices: ["Glow stick", "Watchtower lamp", "Street light", "Generator"], answer: 0 },
  { id: "r06", difficulty: "recruit", prompt: "Why should wet clothing be dried?", choices: ["To reduce heat loss", "To increase noise", "To hide the compass", "To repair footwear"], answer: 0 },
  { id: "r07", difficulty: "recruit", prompt: "Why carry a backup light source after dark?", choices: ["The primary light can fail or run out", "It makes rain stop", "It changes the map", "It removes thirst"], answer: 0 },
  { id: "r08", difficulty: "recruit", prompt: "What is a practical reason to keep a blade or cutting tool?", choices: ["Opening and preparing basic supplies", "Increasing radio range", "Preventing fall damage", "Finding players automatically"], answer: 0 },
  { id: "r09", difficulty: "recruit", prompt: "Before crossing an exposed road, what reduces avoidable risk?", choices: ["Check both approaches first", "Drop all equipment", "Run without looking", "Turn on every light"], answer: 0 },
  { id: "r10", difficulty: "recruit", prompt: "Why keep food and water available before a long move?", choices: ["Stops can become unsafe later", "It grants extra stamina forever", "It repairs clothing", "It reveals hidden loot"], answer: 0 },
  { id: "r11", difficulty: "recruit", prompt: "What should a survivor do with badly damaged footwear?", choices: ["Repair or replace it before a long route", "Use it to mark a map", "Hide it in running water", "Trade it for a compass automatically"], answer: 0 },
  { id: "r12", difficulty: "recruit", prompt: "What is the best use of a short shelter stop during bad weather?", choices: ["Regain warmth and assess supplies", "Broadcast your position publicly", "Restart the server", "Discard dry clothing"], answer: 0 },
  { id: "o01", difficulty: "operator", prompt: "What is the safest way to confirm another player is friendly?", choices: ["Communicate while keeping cover", "Sprint directly at them", "Fire a warning shot beside them", "Drop every item immediately"], answer: 0 },
  { id: "o02", difficulty: "operator", prompt: "Why keep high-value supplies split between containers?", choices: ["One loss does not remove everything", "It doubles their durability", "It removes their weight", "It makes them invisible"], answer: 0 },
  { id: "o03", difficulty: "operator", prompt: "What is the main benefit of moving along tree lines?", choices: ["More visual cover", "Unlimited stamina", "Automatic healing", "Guaranteed loot"], answer: 0 },
  { id: "o04", difficulty: "operator", prompt: "Before entering an exposed town, what should a team do first?", choices: ["Observe from cover", "Separate without a plan", "Turn on every light", "Discard navigation tools"], answer: 0 },
  { id: "o05", difficulty: "operator", prompt: "Which habit best protects a base access code?", choices: ["Share it only with trusted members", "Post it in global chat", "Use the server name", "Write it on a public sign"], answer: 0 },
  { id: "o06", difficulty: "operator", prompt: "What makes a fallback route useful?", choices: ["It provides another safe exit", "It increases weapon damage", "It prevents weather", "It creates supplies"], answer: 0 },
  { id: "o07", difficulty: "operator", prompt: "After a loud fight reveals a position, what is usually the sound next step?", choices: ["Relocate and reassess from cover", "Repeat the same angle immediately", "Turn on all lights", "Split without a plan"], answer: 0 },
  { id: "o08", difficulty: "operator", prompt: "What keeps a squad radio call useful under pressure?", choices: ["Short facts, location and intent", "Several stories at once", "Only jokes and nicknames", "Silence after an emergency"], answer: 0 },
  { id: "o09", difficulty: "operator", prompt: "Why avoid cresting a ridgeline at the highest point?", choices: ["The skyline makes movement easier to spot", "It lowers the map resolution", "It repairs equipment", "It guarantees better loot"], answer: 0 },
  { id: "o10", difficulty: "operator", prompt: "What should a team look for before committing to a base approach?", choices: ["Signs of recent activity and escape routes", "A new player title", "The nearest loading screen", "A random weather change"], answer: 0 },
  { id: "o11", difficulty: "operator", prompt: "Why distribute critical supplies across a team?", choices: ["One loss does not remove every capability", "It makes supplies weigh nothing", "It prevents all damage", "It changes the server rules"], answer: 0 },
  { id: "o12", difficulty: "operator", prompt: "When entering a building with limited exits, what should be agreed first?", choices: ["Who watches each direction and the withdrawal plan", "Which player carries every item", "How to make the most noise", "Who removes navigation tools"], answer: 0 },
  { id: "s01", difficulty: "specialist", prompt: "A squad crosses open ground one at a time. What principle are they using?", choices: ["Bounding movement", "Inventory stacking", "Static defence", "Random dispersal"], answer: 0 },
  { id: "s02", difficulty: "specialist", prompt: "Why record the time of a distant gunshot?", choices: ["To compare later movement and risk", "To repair a suppressor", "To change the weather", "To refill ammunition"], answer: 0 },
  { id: "s03", difficulty: "specialist", prompt: "What should lead a route choice during low visibility?", choices: ["Known landmarks and safe bearings", "The loudest nearby sound", "The shortest line regardless of terrain", "Unverified chat messages"], answer: 0 },
  { id: "s04", difficulty: "specialist", prompt: "Why assign one squad member to rear security?", choices: ["To watch the direction already travelled", "To carry every medical item", "To choose all dialogue", "To prevent stamina loss"], answer: 0 },
  { id: "s05", difficulty: "specialist", prompt: "When evidence about a threat conflicts, what is the sound response?", choices: ["Pause and verify before committing", "Assume the most convenient report", "Ignore every report", "Split without communication"], answer: 0 },
  { id: "s06", difficulty: "specialist", prompt: "What best limits damage from a compromised rally point?", choices: ["Use alternates and rotate locations", "Mark it publicly", "Store all supplies there", "Approach by one fixed route"], answer: 0 },
  { id: "s07", difficulty: "specialist", prompt: "What turns a contact report into useful squad intelligence?", choices: ["Time, direction, distance and confidence", "Only a dramatic description", "A guess without a location", "The reporter's inventory"], answer: 0 },
  { id: "s08", difficulty: "specialist", prompt: "Why stage a team before crossing a chokepoint?", choices: ["It limits how many people are exposed at once", "It makes everyone invisible", "It removes the need for cover", "It creates new supplies"], answer: 0 },
  { id: "s09", difficulty: "specialist", prompt: "What should determine whether an old route is still safe?", choices: ["Current observation, conditions and recent contact", "How familiar its name sounds", "The oldest available map", "A single unverified message"], answer: 0 },
  { id: "s10", difficulty: "specialist", prompt: "Why keep a team's reserve supplies outside its primary position?", choices: ["It preserves recovery options after a loss", "It doubles weapon damage", "It guarantees no weather", "It removes the need to communicate"], answer: 0 },
  { id: "s11", difficulty: "specialist", prompt: "During a confused engagement, what makes a withdrawal order actionable?", choices: ["A named direction, destination and regroup cue", "A vague request to run", "Several conflicting orders", "No acknowledgement from the team"], answer: 0 },
  { id: "s12", difficulty: "specialist", prompt: "What is the benefit of recording a server incident after it ends?", choices: ["It supports better decisions if the pattern returns", "It restores lost equipment automatically", "It removes every future risk", "It changes the season standings"], answer: 0 },
] as const;

export const questionById = new Map(TRIVIA_QUESTIONS.map(question => [question.id, question]));
