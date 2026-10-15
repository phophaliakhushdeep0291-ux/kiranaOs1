import * as service from "./ca-portal.service.js";

export async function overview(req, res, next) {
  try {
    const data = await service.getCaOverview(req.user.userId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function clientDetails(req, res, next) {
  try {
    const data = await service.getClientShopDetails(req.params.shopId, req.user.userId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function tallyExport(req, res, next) {
  try {
    const data = await service.getClientTallyExport(req.params.shopId, req.user.userId, req.query);
    if (req.query.format === "xml") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${data.filename || 'tally-export.xml'}"`);
      return res.send(data.xml);
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function generateCode(req, res, next) {
  try {
    const data = await service.generateShopCaInviteCode(req.shopId, req.user.userId, req.body?.expiresInHours);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function linkClient(req, res, next) {
  try {
    const data = await service.linkClientShop(req.user.userId, req.body.linkCode, req.body.note);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function listAccess(req, res, next) {
  try { res.json({ success: true, data: await service.listShopAccess(req.shopId, req.user.userId) }); }
  catch (error) { next(error); }
}

export async function revokeAccess(req, res, next) {
  try { res.json({ success: true, data: await service.revokeShopAccess(req.shopId, req.user.userId, req.params.id) }); }
  catch (error) { next(error); }
}
