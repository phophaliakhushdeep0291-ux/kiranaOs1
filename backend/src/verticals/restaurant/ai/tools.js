/**
 * Restaurant tools for the assistant.
 *
 * They live here, in the trade's own directory, rather than in the shared AI
 * module, because the direction of the dependency is the whole isolation
 * guarantee: a vertical may import shared code, shared code may not import a
 * vertical. tests/business-vertical-architecture.examples.js enforces it, and
 * the practical effect is that a kirana shop's assistant never loads a single
 * line of restaurant code — so a change to the floor plan cannot break a
 * grocer's till.
 *
 * Registration happens on import, and src/app.js is the one place that imports
 * it, exactly as it is the one place that mounts these routes.
 *
 * Every tool here is feature-gated to the same key its HTTP route uses, so a
 * Counter shop — takeaway, cloud kitchen, no floor — is never even told the
 * table tools exist. Advertising a capability the shop has not bought teaches
 * the model to keep offering it.
 */
import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { listTables } from "../tables/tables.service.js";
import { listTickets } from "../kot/kot.service.js";
import { getMenuBoard } from "../menu/menu.service.js";

const MAX_ROWS = 30;

export const RESTAURANT_TOOLS = [
  defineTool({
    name: "restaurant_list_tables",
    keywords: ["table", "tables", "floor", "seat", "seated", "free", "occupied", "guest", "टेबल", "मेज़", "मेज", "खाली", "बैठ"],
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "The floor right now: every table, whether it is free or seated, and the running bill on it. Use this for 'which tables are free', 'what is table 5 on', 'how full are we'.",
    feature: "restaurant_tables",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeInactive: { type: "boolean", description: "Include tables taken out of service." },
      },
    },
    handler: async ({ includeInactive }, ctx) => {
      const tables = await listTables(ctx.shopId, { includeInactive: includeInactive === true });
      return {
        tableCount: tables.length,
        tables: tables.slice(0, MAX_ROWS).map((table) => ({
          id: table.id,
          code: table.code,
          name: table.name,
          status: table.status,
          seats: table.seats ?? null,
          runningTotal: table.runningTotal ?? table.openBillTotal ?? null,
        })),
        truncated: tables.length > MAX_ROWS,
      };
    },
  }),

  defineTool({
    name: "restaurant_kitchen_tickets",
    keywords: ["kitchen", "kot", "ticket", "order", "pending", "ready", "preparing", "cooking", "रसोई", "किचन", "ऑर्डर", "तैयार", "बन"],
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Kitchen tickets and their state, so you can say what the kitchen is still working on and what is ready to go out. Use it for 'what is pending in the kitchen' and 'is table 4's food ready'.",
    feature: "restaurant_kot",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["pending", "preparing", "ready", "served", "cancelled"],
          description: "Only tickets in this state. Omit for everything open.",
        },
      },
    },
    handler: async ({ status }, ctx) => {
      const tickets = await listTickets(ctx.shopId, status ? { status } : {});
      return {
        ticketCount: tickets.length,
        tickets: tickets.slice(0, MAX_ROWS).map((ticket) => ({
          id: ticket.id,
          number: ticket.ticketNo ?? ticket.number ?? null,
          status: ticket.status,
          table: ticket.tableCode ?? ticket.tableName ?? null,
          station: ticket.station ?? null,
          itemCount: Array.isArray(ticket.items) ? ticket.items.length : null,
          firedAt: ticket.firedAt ?? ticket.createdAt ?? null,
        })),
        truncated: tickets.length > MAX_ROWS,
      };
    },
  }),

  defineTool({
    name: "restaurant_menu_board",
    keywords: ["menu", "dish", "dishes", "course", "starter", "main", "dessert", "available", "मेन्यू", "मेनू", "व्यंजन", "डिश", "खाना"],
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "The menu as guests see it, by course, including what is currently marked unavailable. Use it to answer what is on the menu, what a dish costs, and what has been eighty-sixed.",
    feature: "restaurant_menu",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeUnavailable: { type: "boolean", description: "Include dishes currently switched off. Default true." },
      },
    },
    handler: async ({ includeUnavailable }, ctx) => {
      const board = await getMenuBoard(ctx.shopId, { includeUnavailable: includeUnavailable !== false });
      const courses = Array.isArray(board?.courses) ? board.courses : [];
      return {
        courses: courses.map((course) => ({
          course: course.course ?? course.name ?? null,
          dishes: (course.dishes ?? []).slice(0, MAX_ROWS).map((dish) => ({
            id: dish.id,
            name: dish.name,
            price: dish.price ?? null,
            available: dish.available !== false,
          })),
        })),
      };
    },
  }),
];

registerTools("restaurant", RESTAURANT_TOOLS);
