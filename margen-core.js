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

  // Los valores por defecto de MargenClear. El buscador arranca de los mismos
  // para que "Ajustar con mi cotizacion" de el mismo numero de entrada.
  var DEFAULTS = { ivaComisionPct: 21, cargoCuotasPct: 0, iibbPct: 3, percAfipPct: 0, otrosVarPct: 0, devolucionesPct: 2, impGananciasPct: 0 };

  return { calcularUnidad: calcularUnidad, DEFAULTS: DEFAULTS };
});
