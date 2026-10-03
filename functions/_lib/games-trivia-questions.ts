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
  { id: "o01", difficulty: "operator", prompt: "What is the safest way to confirm another player is friendly?", choices: ["Communicate while keeping cover", "Sprint directly at them", "Fire a warning shot beside them", "Drop every item immediately"], answer: 0 },
  { id: "o02", difficulty: "operator", prompt: "Why keep high-value supplies split between containers?", choices: ["One loss does not remove everything", "It doubles their durability", "It removes their weight", "It makes them invisible"], answer: 0 },
  { id: "o03", difficulty: "operator", prompt: "What is the main benefit of moving along tree lines?", choices: ["More visual cover", "Unlimited stamina", "Automatic healing", "Guaranteed loot"], answer: 0 },
  { id: "o04", difficulty: "operator", prompt: "Before entering an exposed town, what should a team do first?", choices: ["Observe from cover", "Separate without a plan", "Turn on every light", "Discard navigation tools"], answer: 0 },
  { id: "o05", difficulty: "operator", prompt: "Which habit best protects a base access code?", choices: ["Share it only with trusted members", "Post it in global chat", "Use the server name", "Write it on a public sign"], answer: 0 },
  { id: "o06", difficulty: "operator", prompt: "What makes a fallback route useful?", choices: ["It provides another safe exit", "It increases weapon damage", "It prevents weather", "It creates supplies"], answer: 0 },
  { id: "s01", difficulty: "specialist", prompt: "A squad crosses open ground one at a time. What principle are they using?", choices: ["Bounding movement", "Inventory stacking", "Static defence", "Random dispersal"], answer: 0 },
  { id: "s02", difficulty: "specialist", prompt: "Why record the time of a distant gunshot?", choices: ["To compare later movement and risk", "To repair a suppressor", "To change the weather", "To refill ammunition"], answer: 0 },
  { id: "s03", difficulty: "specialist", prompt: "What should lead a route choice during low visibility?", choices: ["Known landmarks and safe bearings", "The loudest nearby sound", "The shortest line regardless of terrain", "Unverified chat messages"], answer: 0 },
  { id: "s04", difficulty: "specialist", prompt: "Why assign one squad member to rear security?", choices: ["To watch the direction already travelled", "To carry every medical item", "To choose all dialogue", "To prevent stamina loss"], answer: 0 },
  { id: "s05", difficulty: "specialist", prompt: "When evidence about a threat conflicts, what is the sound response?", choices: ["Pause and verify before committing", "Assume the most convenient report", "Ignore every report", "Split without communication"], answer: 0 },
  { id: "s06", difficulty: "specialist", prompt: "What best limits damage from a compromised rally point?", choices: ["Use alternates and rotate locations", "Mark it publicly", "Store all supplies there", "Approach by one fixed route"], answer: 0 },
] as const;

export const questionById = new Map(TRIVIA_QUESTIONS.map(question => [question.id, question]));
