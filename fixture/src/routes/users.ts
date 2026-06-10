import { router } from "../app";

// public
router.get("/health", (req, res) => res.json({ ok: true }));

router.get("/users", requireAuth, (req, res) => res.json(getUsers()));
