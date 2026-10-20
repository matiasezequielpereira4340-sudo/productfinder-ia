// margen-core.js
// La cuenta de ganancia por unidad, en un solo lugar.
//
// Antes habia tres versiones distintas de "cuanto te queda": la de MargenClear
// (margen.html), un "margen" del buscador que en realidad era markup sobre el
// costo (222%) y un "dato real" que restaba solo el costo. En la misma tarjeta
// salian tres numeros que no cerraban. Ahora margen.html y /api/analyze usan
// esta misma funcion: lo que dice el buscador es lo que despues da MargenClear.
//
// Se carga como <script> en el navegador (window.MargenCore) y con import en
// el servidor (module.exports). No toca el DOM.
(function (root, fabrica) {
  var m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  if (root) root.MargenCore = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function num(v, porDefecto) {
    var n = Number(v);
    return isFinite(n) ? n : porDefecto;
  }

  // Todo por unidad, en ARS. Los porcentajes van en puntos (13.5 = 13,5%).
  //   precio            precio de venta final (con IVA)
  //   costo             costo del producto puesto en tu deposito
  //   comisionBasePct   comision del canal (MeLi: segun categoria y tipo)
  //   ivaComisionPct    IVA que MeLi factura sobre su comision
  //   cargoCuotasPct    recargo por cuotas sin interes
  //   cargoFijo         cargo fijo por unidad (MeLi lo cobra en precios bajos)
  //   envio, empaque    ARS por unidad
  //   iibbPct, percAfipPct, otrosVarPct  sobre el precio de venta
  //   devolucionesPct   % de ventas devueltas (se pierde ~30% del valor)
  //   impGananciasPct   sobre la ganancia neta
  //   ivaVentaPct       IVA de la venta (0 = no se descuenta, como MargenClear)
  //   ivaCreditoARS     IVA ya pagado en la importacion, que se descuenta del debito
  function calcularUnidad(e) {
    var precio = num(e.precio, 0);
    var costo = num(e.costo, 0);
    var comisionBasePct = num(e.comisionBasePct, 0);
    var ivaComisionPct = num(e.ivaComisionPct, 21);
    var cargoCuotasPct = num(e.cargoCuotasPct, 0);
    var comisionTotalPct = comisionBasePct * (1 + ivaComisionPct / 100) + cargoCuotasPct;

    var comisionPura = precio * comisionBasePct / 100;
    var ivaComisionARS = precio * comisionBasePct * ivaComisionPct / 100 / 100;
    var cargoCuotasARS = precio * cargoCuotasPct / 100;
    var cargoFijo = num(e.cargoFijo, 0);
    var comisionARS = precio * comisionTotalPct / 100 + cargoFijo;
    var iibbARS = precio * num(e.iibbPct, 0) / 100;
    var percAfipARS = precio * num(e.percAfipPct, 0) / 100;
    var otrosVarARS = precio * num(e.otrosVarPct, 0) / 100;
    var envioARS = num(e.envio, 0);
    var empaqueARS = num(e.empaque, 0);

    var ivaVentaPct = num(e.ivaVentaPct, 0);
    var ivaDebitoARS = ivaVentaPct > 0 ? precio - precio / (1 + ivaVentaPct / 100) : 0;
    var ivaCreditoARS = ivaVentaPct > 0 ? Math.max(0, num(e.ivaCreditoARS, 0)) : 0;
    var ivaNetoARS = Math.max(0, ivaDebitoARS - ivaCreditoARS);

    var costosTotalesARS = costo + comisionARS + iibbARS + percAfipARS + otrosVarARS + envioARS + empaqueARS + ivaNetoARS;
    var ganBruta = precio - costo;
    var ganAntesDev = precio - costosTotalesARS;
    var impactoDevARS = precio * num(e.devolucionesPct, 0) / 100 * 0.3;
    var ganNeta = ganAntesDev - impactoDevARS;
    var impGanARS = ganNeta > 0 ? ganNeta * num(e.impGananciasPct, 0) / 100 : 0;
    var ganReal = ganNeta - impGanARS;
    var margenPct = precio > 0 ? (ganReal / precio) * 100 : 0;
    var roi = costo > 0 ? (ganReal / costo) * 100 : 0;

    return {
      precio: precio, costo: costo,
      comisionBasePct: comisionBasePct, comisionTotalPct: comisionTotalPct,
      comisionPura: comisionPura, ivaComisionARS: ivaComisionARS, cargoCuotasARS: cargoCuotasARS,
      cargoFijo: cargoFijo, comisionARS: comisionARS,
      iibbARS: iibbARS, percAfipARS: percAfipARS, otrosVarARS: otrosVarARS,
      envioARS: envioARS, empaqueARS: empaqueARS,
      ivaDebitoARS: ivaDebitoARS, ivaCreditoARS: ivaCreditoARS, ivaNetoARS: ivaNetoARS,
      costosTotalesARS: costosTotalesARS, ganBruta: ganBruta, ganAntesDev: ganAntesDev,
      impactoDevARS: impactoDevARS, ganNeta: ganNeta, impGanARS: impGanARS, ganReal: ganReal,
      margenPct: margenPct, roi: roi
    };
  }

  // Costo de importacion por unidad, carga consolidada maritima.
  //
  // Reemplaza el modelo courier (flete minimo USD 2,50/u x 1,85 de todo), que
  // hacia inviable cualquier producto barato. Ahora:
  //   logistica  = volumen empaquetado (m3) x USD por m3 puerta a puerta
  //                (FLETE_USD_M3, 450 por defecto: flete + despacho + gastos)
  //   base       = FOB + logistica (conservador: el CIF real es menor, porque
  //                despacho y gastos locales no tributan)
  //   derechos   = base x derecho de importacion de la posicion (diPct)
  //   tasa       = base x tasa de estadistica (3%)
  //   IVA 21% e IVA adicional 20% sobre base + derechos + tasa: credito fiscal
  //   Ganancias 6% e IIBB 2,5% sobre lo mismo: pagos a cuenta (se recuperan
  //   contra tus impuestos, pero inmovilizan plata)
  // costo = FOB + logistica + derechos + tasa (lo que no se recupera).
  function costoImportacion(e) {
    var fob = num(e.fobUSD, 0);
    var vol = Math.max(0, num(e.volCm3, 0)) / 1e6;
    var fleteM3 = num(e.fleteUsdM3, 450);
    var tc = num(e.usdArs, 1);
    var logistica = vol * fleteM3;
    var base = fob + logistica;
    var derechos = base * num(e.diPct, 20) / 100;
    var tasa = base * num(e.tasaEstPct, 3) / 100;
    var baseIva = base + derechos + tasa;
    var iva = baseIva * num(e.ivaPct, 21) / 100;
    var ivaAdic = baseIva * num(e.ivaAdicPct, 20) / 100;
    var ganancias = baseIva * num(e.gananciasPct, 6) / 100;
    var iibb = baseIva * num(e.iibbPct, 2.5) / 100;
    var costo = fob + logistica + derechos + tasa;
    var r2 = function (x) { return Math.round(x * 100) / 100; };
    return {
      fobUSD: r2(fob), volCm3: Math.round(vol * 1e6), fleteUsdM3: fleteM3, logisticaUSD: r2(logistica),
      baseUSD: r2(base), derechosUSD: r2(derechos), diPct: num(e.diPct, 20), tasaUSD: r2(tasa),
      ivaUSD: r2(iva), ivaAdicUSD: r2(ivaAdic), gananciasUSD: r2(ganancias), iibbUSD: r2(iibb),
      costoUSD: r2(costo), creditoIvaUSD: r2(iva + ivaAdic), pagosACuentaUSD: r2(ganancias + iibb),
      desembolsoUSD: r2(costo + iva + ivaAdic + ganancias + iibb),
      costoARS: Math.round(costo * tc), creditoIvaARS: Math.round((iva + ivaAdic) * tc),
      pagosACuentaARS: Math.round((ganancias + iibb) * tc), desembolsoARS: Math.round((costo + iva + ivaAdic + ganancias + iibb) * tc)
    };
  }

  // Los valores por defecto de MargenClear. El buscador arranca de los mismos
  // para que "Ajustar con mi cotizacion" de el mismo numero de entrada.
  var DEFAULTS = { ivaComisionPct: 21, cargoCuotasPct: 0, iibbPct: 3, percAfipPct: 0, otrosVarPct: 0, devolucionesPct: 2, impGananciasPct: 0 };

  return { calcularUnidad: calcularUnidad, costoImportacion: costoImportacion, DEFAULTS: DEFAULTS };
});
