import { CONFIG } from './config.js';
import { ApiError, SportimeApi } from './supabase-rest.js';

const api = new SportimeApi();
const $ = selector => document.querySelector(selector);
const state = {
  products: [], cart: [], profile: null, settings: {}, orders: [],
  query: '', category: 'Todos', loading: true, cloudError: '',
  adminTab: 'dashboard', adminProducts: [], adminOrders: [], adminProfiles: [],
  coupons: [], selectedAdminProduct: null, lastCatalogLoad: 0,
  adminMenuOpen: false
};

function node(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = String(value);
    else if (key === 'value') element.value = value;
    else if (key === 'checked') element.checked = Boolean(value);
    else if (key === 'disabled') element.disabled = Boolean(value);
    else if (key === 'dataset') Object.entries(value).forEach(([name, item]) => { element.dataset[name] = item; });
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, String(value));
  });
  const list = Array.isArray(children) ? children : [children];
  list.flat(Infinity).forEach(child => {
    if (child === undefined || child === null || child === false) return;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return element;
}

function replace(root, ...children) {
  root.replaceChildren(...children.flat(Infinity).filter(Boolean));
  return root;
}

function money(value) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, location.origin);
    if (url.origin === location.origin) return url.href;
    if (url.protocol === 'https:' && url.hostname === 'yvelpgtmmrkiewogumtd.supabase.co') return url.href;
  } catch { /* URL inválida */ }
  return '';
}

function toast(message, type = '') {
  const item = node('div', { class: `toast ${type}`, role: 'status', text: message });
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 4200);
}

function friendlyError(error) {
  const text = String(error?.message || error || 'Error desconocido');
  if (/invalid login credentials/i.test(text)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(text)) return 'Primero confirmá tu correo electrónico.';
  if (/user already registered/i.test(text)) return 'Ese correo ya está registrado.';
  if (/failed to fetch|networkerror|load failed/i.test(text)) return 'No se pudo conectar. Revisá internet e intentá nuevamente.';
  if (/jwt expired|invalid jwt/i.test(text)) return 'La sesión venció. Volvé a ingresar.';
  return text.replace(/^Error:\s*/i, '');
}

function loading(show, message = 'Procesando…') {
  document.querySelector('.loading-overlay')?.remove();
  if (!show) return;
  document.body.append(node('div', { class: 'loading-overlay', role: 'status' },
    node('div', { class: 'loading-card' }, [node('div', { class: 'spinner' }), node('b', { text: message })])));
}

async function confirmAction(title, message) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

function isStaff() { return ['admin', 'operator'].includes(state.profile?.role); }
function isOwner() { return state.profile?.role === 'admin'; }
function productPrice(product) { return Number(product.cashPrice) > 0 ? Number(product.cashPrice) : Number(product.listPrice) || 0; }
function totalStock(product) { return product.variants.reduce((sum, item) => sum + Math.max(0, Number(item.stock) || 0), 0); }
function cartQuantity() { return state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0); }
function cartTotal() { return state.cart.reduce((sum, item) => sum + productPrice(item.product) * item.quantity, 0); }

function mapProduct(row) {
  const details = Array.isArray(row.product_web_details) ? row.product_web_details[0] : row.product_web_details;
  const variants = (row.product_variants || []).filter(item => item.active !== false).map(item => ({
    id: item.id,
    name: [item.size || item.name || 'Único', item.color].filter(Boolean).join(' / '),
    barcode: String(item.barcode || ''),
    stock: Number(item.stock) || 0,
    sort: Number(item.sort_order) || 0
  })).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const images = (row.product_images || []).map(item => ({
    id: item.id, url: safeUrl(item.public_url), path: item.storage_path || '', alt: item.alt_text || '',
    primary: Boolean(item.is_primary), sort: Number(item.sort_order) || 0
  })).filter(item => item.url).sort((a, b) => Number(b.primary) - Number(a.primary) || a.sort - b.sort);
  return {
    id: row.id, sku: String(row.sku || ''), name: String(details?.web_title || row.name || 'Producto'),
    baseName: String(row.name || ''), brand: String(row.brand || ''), category: String(row.category || 'Sin categoría'),
    subcategory: String(row.subcategory || ''), listPrice: Number(row.list_price) || 0,
    cashPrice: Number(row.cash_price) || 0, transferPrice: Number(details?.extra_data?.transfer_price) || Number(row.cash_price) || Number(row.list_price) || 0, installments: Number(row.installments_3) || 0,
    active: row.active !== false, published: details?.is_published !== false && row.status === 'published',
    description: String(details?.description || ''), shortDescription: String(details?.short_description || ''),
    slug: String(details?.slug || ''), featured: Boolean(details?.featured), isNew: Boolean(details?.new_product), hot: Boolean(details?.hot),
    sizeGuide: safeUrl(details?.size_guide_url), video: safeUrl(details?.video_url), seoTitle: String(details?.seo_title || ''),
    seoDescription: String(details?.seo_description || ''), extraData: details?.extra_data || {}, variants, images
  };
}

const catalogSelect = [
  'id','sku','name','category','subcategory','brand','list_price','cash_price','installments_3','status','active','source_id',
  'product_variants(id,name,size,color,barcode,stock,active,sort_order)',
  'product_images(id,storage_path,public_url,alt_text,is_primary,sort_order)',
  'product_web_details(web_title,slug,description,short_description,is_published,featured,new_product,hot,size_guide_url,video_url,seo_title,seo_description,extra_data)'
].join(',');

async function loadCatalog(admin = false) {
  const query = { select: catalogSelect, order: 'name.asc' };
  if (!admin) { query.active = 'eq.true'; query.status = 'eq.published'; }
  const rows = await api.rest('products', { query, token: Boolean(api.session) });
  const products = rows.map(mapProduct).filter(product => admin || product.published);
  if (admin) state.adminProducts = products;
  else { state.products = products; state.lastCatalogLoad = Date.now(); }
  return products;
}

async function loadSettings() {
  const data = await api.rpc('get_sportime_storefront_settings', {}, { token: Boolean(api.session) });
  state.settings = data || {};
  document.title = `${state.settings.store_name || 'SPORTIME'} | Tienda online`;
  $('#legal-identity').textContent = [state.settings.business_name, state.settings.cuit ? `CUIT ${state.settings.cuit}` : '', state.settings.address].filter(Boolean).join(' · ');
}

async function loadProfile() {
  state.profile = api.user ? await api.profile() : null;
  $('#account-label').textContent = state.profile?.full_name?.split(' ')[0] || 'Ingresar';
}

async function loadCart() {
  if (!api.user) { state.cart = []; updateCartCount(); return; }
  const rows = await api.rest('cart_reservations', {
    query: { select: 'product_id,variant_id,quantity,expires_at', user_id: `eq.${api.user.id}`, order: 'created_at.asc' }
  });
  state.cart = rows.map(row => {
    const product = state.products.find(item => item.id === row.product_id) || state.adminProducts.find(item => item.id === row.product_id);
    const variant = product?.variants.find(item => item.id === row.variant_id);
    return product && variant ? { ...row, quantity: Number(row.quantity) || 0, product, variant } : null;
  }).filter(Boolean);
  updateCartCount();
}

function updateCartCount() { $('#cart-count').textContent = String(cartQuantity()); }

async function initialLoad() {
  state.loading = true;
  renderRoute();
  try {
    if (api.session) {
      try { await api.ensureFreshSession(); } catch { api.setSession(null); }
    }
    await Promise.all([loadCatalog(false), loadSettings()]);
    if (api.user) await loadProfile();
    await loadCart();
    state.cloudError = '';
    setCloudStatus(true, 'SPORTIME conectado · catálogo y stock sincronizados');
  } catch (error) {
    console.error(error);
    state.cloudError = friendlyError(error);
    setCloudStatus(false, `Sin conexión: ${state.cloudError}`);
  } finally {
    state.loading = false;
    renderRoute();
  }
}

function setCloudStatus(ok, message) {
  const bar = $('#connection-bar');
  bar.className = `connection-bar ${ok ? 'ok' : 'error'}`;
  bar.textContent = message;
}

function renderCategories() {
  const detected = [...new Set(state.products.map(productCategory).filter(Boolean))];
  const preferred = ['INDUMENTARIA / CALZADO', 'SHAKER', 'SUPLEMENTOS', 'ACCESORIOS'];
  const categories = ['Todos', ...preferred.filter(category => detected.includes(category)), ...detected.filter(category => !preferred.includes(category)).sort()];
  replace($('#category-nav'), categories.map(category => node('button', {
    type: 'button', class: state.category === category ? 'active' : '', text: categoryLabel(category),
    onclick: () => { state.category = category; location.hash = '#catalogo'; renderRoute(); }
  })));
}

function categoryLabel(category) {
  return category === 'INDUMENTARIA / CALZADO' ? 'INDUMENTARIA' : category;
}

function publicHeroText(value) {
  const text = String(value || 'Suplementos, indumentaria y accesorios deportivos.');
  return text.replace(/indumentaria,\s*suplementos,\s*calzado\s*y\s*accesorios deportivos\.?/i, 'Suplementos, indumentaria y accesorios deportivos.');
}

function productCategory(product) {
  return String(product.category || 'Sin categoría').replace(/\s+/g, ' ').trim().toUpperCase();
}

function publicProductSearchText(product) {
  return normalized([product.name, product.baseName, product.brand].join(' '));
}

function hideSearchSuggestions() {
  const box = $('#search-suggestions');
  if (box) { box.hidden = true; box.replaceChildren(); }
  $('#search-input')?.setAttribute('aria-expanded', 'false');
}

function renderSearchSuggestions(value) {
  const box = $('#search-suggestions'), input = $('#search-input'), q = normalized(value);
  if (!box || q.length < 2) return hideSearchSuggestions();
  const matches = state.products.filter(product => publicProductSearchText(product).includes(q)).slice(0, 7);
  if (!matches.length) {
    replace(box, node('div', { class: 'search-suggestion-empty', text: `No encontramos productos para “${String(value).trim()}”` }));
  } else {
    replace(box, matches.map(product => node('button', { type: 'button', role: 'option', class: 'search-suggestion', onclick: () => {
      state.query = ''; state.category = 'Todos'; input.value = ''; hideSearchSuggestions(); openProduct(product.id);
    } }, [
      node('div', { class: 'search-suggestion-image' }, product.images[0] ? node('img', { src: product.images[0].url, alt: '' }) : node('span', { text: '◈' })),
      node('div', { class: 'search-suggestion-info' }, [node('b', { text: product.name }), node('span', { text: product.brand || 'SPORTIME' })]),
      node('strong', { text: money(productPrice(product)) })
    ])));
  }
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function productImage(product, className = '') {
  const image = product.images[0];
  if (image) return node('img', { src: image.url, alt: image.alt || product.name, loading: 'lazy', decoding: 'async', class: className });
  return node('div', { class: `product-placeholder ${className}`, 'aria-hidden': 'true', text: '◈' });
}

function productCard(product) {
  const badges = node('div', { class: 'badge-row' }, [
    product.isNew && node('span', { class: 'badge green', text: 'NUEVO' }),
    product.hot && node('span', { class: 'badge', text: 'HOT' }),
    product.featured && node('span', { class: 'badge', text: 'DESTACADO' })
  ]);
  const available = totalStock(product) > 0;
  const regularPrice = product.listPrice > 0 ? product.listPrice : productPrice(product);
  const cashPrice = product.cashPrice > 0 ? product.cashPrice : productPrice(product);
  return node('article', { class: 'product-card' }, [
    node('button', { class: 'product-image', type: 'button', 'aria-label': `Ver ${product.name}`, onclick: () => openProduct(product.id) }, [productImage(product), badges]),
    node('div', { class: 'product-body' }, [
      node('span', { class: 'product-brand', text: product.brand || 'SPORTIME' }),
      node('h3', { text: product.name }),
      node('div', { class: 'meta', text: [categoryLabel(productCategory(product)), product.subcategory].filter(Boolean).join(' · ') }),
      node('div', { class: 'price', text: money(regularPrice) }),
      node('div', { class: 'payment-options' }, [
        node('div', { class: 'payment-pill cash' }, [node('small', { text: 'PRECIO EFECTIVO' }), node('b', { text: money(cashPrice) })]),
        node('div', { class: 'payment-pill transfer' }, [node('small', { text: 'TRANSFERENCIA' }), node('b', { text: money(product.transferPrice) })]),
        product.installments > 0 && node('div', { class: 'payment-installment' }, [node('span', { text: '3 cuotas sin interés de' }), node('b', { text: money(product.installments) })])
      ]),
      node('div', { class: `stock-status ${available ? '' : 'out'}`, text: available ? 'Disponible para compra' : 'Sin stock disponible' }),
      node('button', { class: 'button buy-button', type: 'button', disabled: !available, text: available ? 'COMPRAR' : 'SIN STOCK', onclick: () => openProduct(product.id) })
    ])
  ]);
}

function filteredProducts() {
  const q = normalized(state.query);
  return state.products.filter(product => {
    const categoryMatch = state.category === 'Todos' || productCategory(product) === state.category;
    const text = publicProductSearchText(product);
    return categoryMatch && (!q || text.includes(q));
  });
}

function renderHome() {
  const root = $('#app');
  const hero = node('section', { class: 'hero' }, node('div', { class: 'hero-content' }, [
    node('span', { class: 'eyebrow', text: state.settings.hero_kicker || 'TIENDA OFICIAL' }),
    node('h1', { text: state.settings.hero_title || 'Entrená fuerte. Elegí mejor.' }),
    node('p', { text: publicHeroText(state.settings.hero_text) }),
    node('div', { class: 'button-row' }, [
      node('a', { class: 'button primary', href: '#catalogo', text: state.settings.hero_button || 'VER CATÁLOGO' }),
      node('button', { class: 'button ghost', type: 'button', text: 'CONSULTAR POR WHATSAPP', onclick: openWhatsApp })
    ])
  ]));
  const heroImage = safeUrl(state.settings.hero_image);
  if (heroImage) hero.style.backgroundImage = `linear-gradient(90deg,rgba(5,8,6,.9),rgba(5,8,6,.28)),url("${heroImage}")`;
  const featured = state.products.filter(item => item.featured).slice(0, 8);
  const selection = featured.length ? featured : state.products.slice(0, 8);
  replace(root, hero, node('section', { class: 'section' }, [
    node('div', { class: 'section-head' }, node('div', {}, [node('h2', { text: 'Elegidos para vos' }), node('p', { text: 'Stock confirmado por el sistema de gestión.' })])),
    selection.length ? node('div', { class: 'product-grid' }, selection.map(productCard)) : node('div', { class: 'empty-state', text: 'Todavía no hay productos publicados.' })
  ]));
}

function renderCatalog() {
  const products = filteredProducts();
  replace($('#app'), node('section', { class: 'section' }, [
    node('div', { class: 'section-head' }, [
      node('div', {}, [node('h1', { text: state.category === 'Todos' ? 'Catálogo' : categoryLabel(state.category) }), node('p', { text: `${products.length} producto${products.length === 1 ? '' : 's'} encontrado${products.length === 1 ? '' : 's'}` })]),
      state.query && node('button', { class: 'button secondary', type: 'button', text: `Limpiar búsqueda “${state.query}”`, onclick: () => { state.query = ''; $('#search-input').value = ''; renderRoute(); } })
    ]),
    products.length ? node('div', { class: 'product-grid' }, products.map(productCard)) : node('div', { class: 'empty-state' }, [node('h2', { text: 'No encontramos productos' }), node('p', { text: 'Probá con otro nombre, marca o categoría.' })])
  ]));
}

function renderLoading() {
  replace($('#app'), node('section', { class: 'section' }, [node('div', { class: 'skeleton-grid' }, [1,2,3,4].map(() => node('div', { class: 'skeleton' }))) ]));
}

function renderCloudError() {
  replace($('#app'), node('section', { class: 'section' }, node('div', { class: 'notice danger' }, [
    node('h1', { text: 'No se pudo abrir la tienda' }), node('p', { text: state.cloudError }),
    node('p', { text: 'La tienda no muestra datos locales viejos: primero debe validar catálogo, precios y stock en Supabase.' }),
    node('button', { class: 'button primary', type: 'button', text: 'REINTENTAR', onclick: initialLoad })
  ])));
}

function renderStaticPage(kind) {
  const defaultPrivacy = 'SPORTIME utiliza los datos solicitados para administrar cuentas, reservas, pedidos, entregas y atención posventa. Podés solicitar acceso, rectificación o supresión mediante los canales de contacto publicados. Las credenciales se gestionan con Supabase Auth y nunca se guardan como texto dentro de la página.';
  const defaultTerms = `Vendedor: ${state.settings.business_name || state.settings.store_name || 'SPORTIME'}${state.settings.cuit ? ` · CUIT ${state.settings.cuit}` : ''}. Los precios, el stock y el total se validan al confirmar el pedido. La compra queda sujeta a la forma de entrega, pago, cambios y devoluciones informadas en esta tienda.`;
  const data = {
    contacto: ['Contacto', `WhatsApp: ${state.settings.whatsapp || 'a configurar'} · Email: ${state.settings.email || 'a configurar'} · ${state.settings.address || ''}`],
    envios: ['Envíos y retiros', state.settings.shipping_policy || 'Podés retirar en el local o coordinar un envío. El costo y el plazo se confirman antes del despacho.'],
    cambios: ['Cambios y devoluciones', state.settings.returns_policy || 'Conservá el producto sin uso, con etiquetas y comprobante. Contactanos para coordinar el cambio o la devolución.'],
    privacidad: ['Privacidad y datos personales', state.settings.privacy_policy || defaultPrivacy],
    terminos: ['Términos de compra', state.settings.terms_policy || defaultTerms]
  }[kind] || ['Información', 'Sección no disponible.'];
  replace($('#app'), node('section', { class: 'section' }, node('div', { class: 'panel' }, [node('h1', { text: data[0] }), node('p', { class: 'legal-copy', text: data[1] }), kind === 'contacto' && node('button', { class: 'button primary', text: 'ABRIR WHATSAPP', onclick: openWhatsApp })])));
}

function renderWithdrawal() {
  const result = node('div', { class: 'form-error', role: 'alert' });
  const form = node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); loading(true, 'Registrando solicitud…');
    try {
      const response = await api.rpc('submit_sportime_withdrawal_request', {
        p_order_number: data.get('order_number') ? Number(data.get('order_number')) : null,
        p_email: String(data.get('email') || '').trim().toLowerCase(),
        p_full_name: String(data.get('full_name') || '').trim(),
        p_phone: String(data.get('phone') || '').trim(),
        p_reason: String(data.get('reason') || '').trim()
      }, { token: Boolean(api.session) });
      result.className = 'notice success'; result.textContent = `Solicitud registrada. Número de gestión: ${response.request_number}. Guardalo como comprobante.`;
      event.currentTarget.reset();
    } catch (error) { result.className = 'form-error'; result.textContent = friendlyError(error); }
    finally { loading(false); }
  } }, [
    labeledInput('Número de pedido', { name: 'order_number', type: 'number', min: '1', inputmode: 'numeric' }),
    labeledInput('Nombre y apellido', { name: 'full_name', value: state.profile?.full_name || '', maxlength: '120', required: true }),
    labeledInput('Email usado en la compra', { name: 'email', type: 'email', value: state.profile?.email || '', maxlength: '254', required: true }),
    labeledInput('WhatsApp', { name: 'phone', type: 'tel', value: state.profile?.phone || '', maxlength: '30' }),
    node('label', { class: 'field' }, [node('span', { text: 'Detalle de la solicitud' }), node('textarea', { name: 'reason', rows: '5', maxlength: '1000', required: true })]),
    result, node('button', { class: 'button danger', type: 'submit', text: 'SOLICITAR ARREPENTIMIENTO' })
  ]);
  replace($('#app'), node('section', { class: 'section' }, [adminTitle('Botón de arrepentimiento', 'Podés solicitar la revocación de una compra sin necesidad de iniciar sesión.'), node('div', { class: 'panel' }, [node('p', { text: 'Completá el formulario. El sistema genera un número de gestión y SPORTIME continuará el trámite por tus datos de contacto.' }), form]) ]));
}

function openWhatsApp() {
  const number = String(state.settings.whatsapp || '').replace(/\D/g, '');
  if (!number) return toast('El WhatsApp de la tienda todavía no está configurado.', 'error');
  window.open(`https://wa.me/${number}?text=${encodeURIComponent('Hola SPORTIME, quiero realizar una consulta.')}`, '_blank', 'noopener,noreferrer');
}

function openProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const dialog = $('#product-dialog');
  let selected = product.variants.find(item => item.stock > 0) || product.variants[0];
  let quantity = 1;
  const content = $('#product-content');
  const render = () => {
    const variantButtons = product.variants.map(variant => node('button', {
      class: `variant-button ${selected?.id === variant.id ? 'active' : ''}`, type: 'button', disabled: variant.stock <= 0,
      text: variant.stock > 0 ? variant.name : `${variant.name} · agotado`, onclick: () => { selected = variant; quantity = 1; render(); }
    }));
    replace(content, node('div', { class: 'product-detail' }, [
      node('div', {}, [node('div', { class: 'detail-media' }, productImage(product)), product.sizeGuide && node('a', { class: 'button secondary', href: product.sizeGuide, target: '_blank', rel: 'noopener noreferrer', text: 'Ver guía de talles' })]),
      node('div', { class: 'detail-info' }, [
        node('span', { class: 'product-brand', text: product.brand || 'SPORTIME' }), node('h1', { text: product.name }),
        node('div', { class: 'meta', text: `SKU ${product.sku} · ${categoryLabel(productCategory(product))}` }), node('div', { class: 'price', text: money(productPrice(product)) }),
        product.installments > 0 && node('p', { class: 'meta', text: `También disponible en 3 cuotas de ${money(product.installments)}` }),
        node('h3', { text: 'Elegí una variante' }), node('div', { class: 'variant-list' }, variantButtons.length ? variantButtons : node('span', { class: 'meta', text: 'Sin variantes disponibles' })),
        node('div', { class: 'stock-status', text: selected?.stock > 0 ? 'Disponible para compra' : 'Sin stock disponible' }),
        node('div', { class: 'button-row' }, [
          node('div', { class: 'quantity' }, [
            node('button', { type: 'button', text: '−', 'aria-label': 'Restar cantidad', onclick: () => { quantity = Math.max(1, quantity - 1); render(); } }),
            node('output', { text: quantity, 'aria-label': 'Cantidad' }),
            node('button', { type: 'button', text: '+', 'aria-label': 'Sumar cantidad', onclick: () => { quantity = Math.min(CONFIG.maxCartQuantity, selected?.stock || 1, quantity + 1); render(); } })
          ]),
          node('button', { class: 'button primary', type: 'button', disabled: !selected || selected.stock <= 0, text: 'AGREGAR AL CARRITO', onclick: async () => { await addToCart(product, selected, quantity); if (dialog.open) dialog.close(); } })
        ]),
        node('hr'), node('h3', { text: 'Descripción' }), node('p', { class: 'description', text: product.description || 'Consultanos para conocer más detalles de este producto.' })
      ])
    ]));
  };
  render();
  dialog.showModal();
}

async function requireAccount() {
  if (api.user && state.profile) return true;
  openAccount('login');
  toast('Ingresá o creá tu cuenta para reservar productos.', 'error');
  return false;
}

async function addToCart(product, variant, amount) {
  if (!await requireAccount()) return;
  loading(true, 'Reservando stock…');
  try {
    for (let index = 0; index < amount; index += 1) {
      await api.rpc('reserve_sportime_cart_item_v3', { p_variant_id: variant.id, p_delta: 1 });
    }
    await Promise.all([loadCatalog(false), loadCart()]);
    renderCategories(); renderRoute(); openCart();
    toast('Producto reservado por 24 horas.', 'success');
  } catch (error) { toast(friendlyError(error), 'error'); }
  finally { loading(false); }
}

async function changeCart(item, delta) {
  loading(true, delta > 0 ? 'Actualizando reserva…' : 'Liberando stock…');
  try {
    await api.rpc('reserve_sportime_cart_item_v3', { p_variant_id: item.variant.id, p_delta: delta });
    await Promise.all([loadCatalog(false), loadCart()]);
    renderRoute(); renderCart();
  } catch (error) { toast(friendlyError(error), 'error'); }
  finally { loading(false); }
}

function openCart() { renderCart(); $('#cart-dialog').showModal(); }

function renderCart() {
  const root = $('#cart-content');
  if (!state.cart.length) return replace(root, node('div', { class: 'empty-state' }, [node('h3', { text: 'Tu carrito está vacío' }), node('p', { text: 'Agregá un producto para comenzar.' })]));
  const lines = state.cart.map(item => node('article', { class: 'cart-line' }, [
    item.product.images[0] ? node('img', { src: item.product.images[0].url, alt: '' }) : node('div', { class: 'cart-thumb', text: '◈' }),
    node('div', {}, [node('h3', { text: item.product.name }), node('div', { class: 'meta', text: item.variant.name }), node('b', { text: money(productPrice(item.product) * item.quantity) }), node('div', { class: 'reserve-time', text: `Reservado hasta ${formatDate(item.expires_at)}` })]),
    node('div', { class: 'quantity' }, [
      node('button', { type: 'button', text: '−', 'aria-label': 'Restar', onclick: () => changeCart(item, -1) }),
      node('output', { text: item.quantity }),
      node('button', { type: 'button', text: '+', 'aria-label': 'Sumar', disabled: item.quantity >= CONFIG.maxCartQuantity || item.variant.stock <= 0, onclick: () => changeCart(item, 1) })
    ])
  ]));
  replace(root, lines, node('div', { class: 'cart-total' }, [node('span', { text: 'Total' }), node('span', { text: money(cartTotal()) })]),
    node('button', { class: 'button primary', type: 'button', text: 'FINALIZAR COMPRA', onclick: () => { $('#cart-dialog').close(); location.hash = '#checkout'; } }));
}

function authHeader(title) {
  return node('div', { class: 'auth-brand' }, [node('div', { class: 'brand' }, [node('span', { text: 'SPOR' }), node('strong', { text: 'TIME' })]), node('p', { class: 'meta', text: title })]);
}

function openAccount(mode = 'login') {
  const dialog = $('#account-dialog');
  const root = $('#account-content');
  if (state.profile) {
    replace(root, authHeader('Cuenta conectada'), node('h2', { text: `Hola, ${state.profile.full_name || 'cliente'}` }),
      node('p', { class: 'meta', text: state.profile.email }),
      node('div', { class: 'button-row' }, [
        node('button', { class: 'button primary', type: 'button', text: isStaff() ? 'ABRIR GESTIÓN EMPRESARIAL' : 'VER MI CUENTA', onclick: () => { dialog.close(); if (isStaff()) location.assign(new URL('./gestion.html', location.href).href); else location.hash = '#cuenta'; } }),
        ...(isStaff() ? [node('button', { class: 'button secondary', type: 'button', text: 'ADMINISTRAR ECOMMERCE', onclick: () => { dialog.close(); location.hash = '#admin'; } })] : []),
        node('button', { class: 'button secondary', type: 'button', text: 'CERRAR SESIÓN', onclick: logout })
      ]));
  } else renderAuthForm(mode);
  dialog.showModal();
}

function authTabs(active) {
  return node('div', { class: 'auth-tabs' }, ['login','register'].map(mode => node('button', {
    type: 'button', class: active === mode ? 'active' : '', text: mode === 'login' ? 'Ingresar' : 'Registrarse', onclick: () => renderAuthForm(mode)
  })));
}

function labeledInput(label, attrs = {}) {
  const input = node('input', attrs);
  return node('label', { class: `field ${attrs.class || ''}` }, [node('span', { text: label }), input]);
}

function renderAuthForm(mode) {
  const root = $('#account-content');
  const error = node('div', { class: 'form-error', role: 'alert' });
  if (mode === 'register') {
    const form = node('form', { class: 'form', onsubmit: async event => {
      event.preventDefault(); error.textContent = '';
      const data = new FormData(event.currentTarget);
      const password = String(data.get('password') || '');
      if (password.length < 10) { error.textContent = 'La contraseña debe tener al menos 10 caracteres.'; return; }
      const metadata = { full_name: data.get('full_name'), dni: data.get('dni'), birth_date: data.get('birth_date'), phone: data.get('phone'), address: data.get('address') };
      loading(true, 'Creando tu cuenta…');
      try {
        const result = await api.signUp(String(data.get('email')).trim().toLowerCase(), password, metadata);
        if (result.access_token) { await afterLogin(); $('#account-dialog').close(); toast('Cuenta creada correctamente.', 'success'); }
        else { renderAuthForm('login'); toast('Cuenta creada. Revisá tu correo para confirmarla.', 'success'); }
      } catch (e) { error.textContent = friendlyError(e); }
      finally { loading(false); }
    } }, [
      labeledInput('Nombre y apellido', { name: 'full_name', autocomplete: 'name', maxlength: '120', required: true }),
      labeledInput('DNI', { name: 'dni', inputmode: 'numeric', minlength: '7', maxlength: '12', required: true }),
      labeledInput('Fecha de nacimiento', { name: 'birth_date', type: 'date', autocomplete: 'bday', required: true }),
      labeledInput('Email', { name: 'email', type: 'email', autocomplete: 'email', maxlength: '254', required: true }),
      labeledInput('WhatsApp', { name: 'phone', type: 'tel', autocomplete: 'tel', maxlength: '30', required: true }),
      labeledInput('Dirección', { name: 'address', autocomplete: 'street-address', maxlength: '240' }),
      labeledInput('Contraseña', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '10', maxlength: '128', required: true }),
      node('small', { class: 'field-help', text: 'Usá al menos 10 caracteres. No reutilices una contraseña de otra cuenta.' }), error,
      node('button', { class: 'button primary', type: 'submit', text: 'CREAR CUENTA' })
    ]);
    replace(root, authHeader('Creá una cuenta segura'), authTabs(mode), form);
  } else {
    const form = node('form', { class: 'form', onsubmit: async event => {
      event.preventDefault(); error.textContent = '';
      const data = new FormData(event.currentTarget); loading(true, 'Verificando acceso…');
      try { await api.signIn(String(data.get('email')).trim().toLowerCase(), String(data.get('password'))); await afterLogin(); $('#account-dialog').close(); toast('Sesión iniciada.', 'success'); }
      catch (e) { error.textContent = friendlyError(e); }
      finally { loading(false); }
    } }, [
      labeledInput('Email', { name: 'email', type: 'email', autocomplete: 'username', maxlength: '254', required: true }),
      labeledInput('Contraseña', { name: 'password', type: 'password', autocomplete: 'current-password', maxlength: '128', required: true }), error,
      node('button', { class: 'button primary', type: 'submit', text: 'INGRESAR' }),
      node('button', { class: 'button secondary', type: 'button', text: 'OLVIDÉ MI CONTRASEÑA', onclick: renderPasswordReset })
    ]);
    replace(root, authHeader('Acceso a tu cuenta'), authTabs(mode), form);
  }
}

function renderPasswordReset() {
  const root = $('#account-content');
  const message = node('div', { class: 'form-error', role: 'alert' });
  replace(root, authHeader('Recuperar contraseña'), node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault(); const email = String(new FormData(event.currentTarget).get('email')).trim().toLowerCase();
    loading(true, 'Enviando correo…');
    try { await api.resetPassword(email); message.className = 'form-success'; message.textContent = 'Si el correo existe, recibirás las instrucciones para recuperar el acceso.'; }
    catch (e) { message.textContent = friendlyError(e); }
    finally { loading(false); }
  } }, [labeledInput('Email', { name: 'email', type: 'email', autocomplete: 'email', required: true }), message, node('button', { class: 'button primary', type: 'submit', text: 'ENVIAR INSTRUCCIONES' }), node('button', { class: 'button secondary', type: 'button', text: 'VOLVER', onclick: () => renderAuthForm('login') })]));
}

function renderNewPassword() {
  const dialog = $('#account-dialog');
  const root = $('#account-content');
  const message = node('div', { class: 'form-error', role: 'alert' });
  const form = node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    const confirmation = String(data.get('confirmation') || '');
    if (password.length < 10) { message.textContent = 'La contraseña debe tener al menos 10 caracteres.'; return; }
    if (password !== confirmation) { message.textContent = 'Las contraseñas no coinciden.'; return; }
    loading(true, 'Actualizando contraseña…');
    try {
      await api.updatePassword(password);
      await afterLogin();
      dialog.close();
      toast('Contraseña actualizada. Tu sesión quedó iniciada.', 'success');
    } catch (error) { message.textContent = friendlyError(error); }
    finally { loading(false); }
  } }, [
    labeledInput('Nueva contraseña', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '10', maxlength: '128', required: true }),
    labeledInput('Repetir contraseña', { name: 'confirmation', type: 'password', autocomplete: 'new-password', minlength: '10', maxlength: '128', required: true }),
    node('small', { class: 'field-help', text: 'Usá al menos 10 caracteres y una clave que no utilices en otros servicios.' }),
    message,
    node('button', { class: 'button primary', type: 'submit', text: 'GUARDAR NUEVA CONTRASEÑA' })
  ]);
  replace(root, authHeader('Crear nueva contraseña'), form);
  dialog.showModal();
}

async function afterLogin() {
  await Promise.all([loadProfile(), loadCatalog(false), loadSettings()]);
  await loadCart();
  renderCategories(); renderRoute();
}

async function logout() {
  loading(true, 'Cerrando sesión…');
  try { await api.signOut(); state.profile = null; state.cart = []; state.orders = []; await loadSettings(); $('#account-label').textContent = 'Ingresar'; $('#account-dialog').close(); location.hash = '#inicio'; renderRoute(); toast('Sesión cerrada.', 'success'); }
  finally { loading(false); }
}

function inputFromProfile(label, name, type = 'text', required = false) {
  return labeledInput(label, { name, type, value: state.profile?.[name] || '', maxlength: type === 'email' ? '254' : '240', required, readonly: type === 'email' });
}

async function loadMyOrders() {
  if (!api.user) return [];
  state.orders = await api.rest('orders', { query: { select: '*,order_items(*)', user_id: `eq.${api.user.id}`, order: 'created_at.desc' } });
  return state.orders;
}

function orderStatus(value) {
  return ({pending:'Pendiente',confirmed:'Confirmado',preparing:'Preparando',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado'})[value] || value || 'Pendiente';
}

function orderCard(order) {
  return node('article', { class: 'order-card' }, [
    node('div', { class: 'order-head' }, [node('div', {}, [node('b', { text: `Pedido #${order.order_number}` }), node('div', { class: 'meta', text: formatDate(order.created_at) })]), node('div', {}, [node('span', { class: `status ${order.status}`, text: orderStatus(order.status) }), node('div', { class: 'price', text: money(order.total) })])]),
    ...(order.order_items || []).map(item => node('div', { class: 'summary-line' }, [node('span', { text: `${item.quantity} × ${item.product_name} · ${item.variant_name || ''}` }), node('b', { text: money(item.line_total) })]))
  ]);
}

async function renderAccountPage() {
  if (!api.user || !state.profile) { openAccount('login'); location.hash = '#inicio'; return; }
  const root = $('#app');
  replace(root, node('section', { class: 'section' }, node('div', { class: 'notice', text: 'Cargando tu cuenta…' })));
  try { await loadMyOrders(); } catch (error) { toast(friendlyError(error), 'error'); }
  const formMessage = node('div', { class: 'form-error', role: 'alert' });
  const profileForm = node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); loading(true, 'Guardando tus datos…');
    try {
      await api.rpc('update_my_sportime_profile', { p_full_name: data.get('full_name'), p_phone: data.get('phone'), p_dni: data.get('dni'), p_birth_date: data.get('birth_date') || null, p_address: data.get('address') });
      await loadProfile(); formMessage.className = 'form-success'; formMessage.textContent = 'Datos actualizados.'; $('#account-label').textContent = state.profile.full_name?.split(' ')[0] || 'Cuenta';
    } catch (error) { formMessage.className = 'form-error'; formMessage.textContent = friendlyError(error); }
    finally { loading(false); }
  } }, [inputFromProfile('Nombre y apellido','full_name','text',true), inputFromProfile('Email','email','email'), inputFromProfile('WhatsApp','phone','tel',true), inputFromProfile('DNI','dni','text',true), inputFromProfile('Fecha de nacimiento','birth_date','date'), inputFromProfile('Dirección','address'), formMessage, node('button', { class: 'button primary', type: 'submit', text: 'GUARDAR DATOS' })]);
  replace(root, node('section', { class: 'section' }, [
    node('div', { class: 'section-head' }, node('div', {}, [node('h1', { text: 'Mi cuenta' }), node('p', { text: state.profile.email })])),
    node('div', { class: 'account-grid' }, [node('div', { class: 'panel' }, [node('h2', { text: 'Mis datos' }), profileForm]), node('div', { class: 'panel' }, [node('h2', { text: 'Mis compras' }), state.orders.length ? state.orders.map(orderCard) : node('p', { class: 'meta', text: 'Todavía no realizaste compras.' })])])
  ]));
}

function checkoutSummary() {
  const items = state.cart.map(item => node('article', { class: 'checkout-product' }, [
    node('div', { class: 'checkout-product-image' }, [
      item.product.images[0]
        ? node('img', { src: item.product.images[0].url, alt: item.product.name, loading: 'lazy', decoding: 'async' })
        : node('div', { class: 'product-placeholder', 'aria-hidden': 'true', text: '◈' }),
      node('span', { class: 'checkout-quantity', text: item.quantity })
    ]),
    node('div', { class: 'checkout-product-info' }, [
      node('b', { text: item.product.name }),
      node('span', { text: item.variant.name || 'Único' }),
      node('small', { text: `${item.quantity} × ${money(productPrice(item.product))}` })
    ]),
    node('strong', { class: 'checkout-product-price', text: money(productPrice(item.product) * item.quantity) })
  ]));
  return node('aside', { class: 'panel summary' }, [node('h2', { text: 'Tu compra' }), node('div', { class: 'checkout-products' }, items), node('div', { class: 'summary-line summary-total' }, [node('span', { text: 'Total' }), node('span', { text: money(cartTotal()) })]), node('p', { class: 'meta', text: 'El servidor valida nuevamente precios, cupones y stock al confirmar.' })]);
}

function renderCheckout() {
  if (!api.user || !state.profile) { openAccount('login'); location.hash = '#inicio'; return; }
  if (!state.cart.length) { location.hash = '#catalogo'; toast('El carrito está vacío.', 'error'); return; }
  const message = node('div', { class: 'form-error', role: 'alert' });
  const form = node('form', { class: 'form', onsubmit: submitCheckout }, [
    node('div', { class: 'form-grid' }, [
      labeledInput('Nombre y apellido', { name: 'full_name', value: state.profile.full_name || '', maxlength: '120', required: true }),
      labeledInput('DNI/CUIT', { name: 'dni', value: state.profile.dni || '', maxlength: '16', required: true }),
      labeledInput('Email', { name: 'email', type: 'email', value: state.profile.email || '', readonly: true }),
      labeledInput('WhatsApp', { name: 'phone', type: 'tel', value: state.profile.phone || '', maxlength: '30', required: true }),
      labeledInput('Domicilio de facturación', { name: 'billing_address', value: state.profile.address || '', maxlength: '240', class: 'full', required: true })
    ]),
    node('h3', { text: 'Entrega' }), node('div', { class: 'choice-list' }, [
      node('label', { class: 'choice' }, [node('input', { type: 'radio', name: 'delivery', value: 'pickup', checked: true }), node('span', {}, [node('b', { text: 'Retiro en el local' }), node('small', { class: 'meta', text: ' Te avisaremos cuando esté listo.' })])]),
      node('label', { class: 'choice' }, [node('input', { type: 'radio', name: 'delivery', value: 'shipping' }), node('span', {}, [node('b', { text: 'Envío a domicilio' }), node('small', { class: 'meta', text: ' El costo se coordina antes del despacho.' })])])
    ]),
    labeledInput('Dirección de entrega (obligatoria si elegís envío)', { name: 'shipping_address', value: state.profile.address || '', maxlength: '240' }),
    node('label', { class: 'field' }, [node('span', { text: 'Indicaciones' }), node('textarea', { name: 'notes', maxlength: '500', rows: '3' })]),
    node('h3', { text: 'Forma de pago' }), node('div', { class: 'choice-list' }, [
      node('label', { class: 'choice' }, [node('input', { type: 'radio', name: 'payment', value: 'transfer', checked: true }), node('span', {}, [node('b', { text: 'Transferencia' }), node('small', { class: 'meta', text: ' Recibirás los datos al confirmar.' })])]),
      node('label', { class: 'choice' }, [node('input', { type: 'radio', name: 'payment', value: 'cash' }), node('span', {}, [node('b', { text: 'Efectivo' }), node('small', { class: 'meta', text: ' Disponible para retiro en el local.' })])])
    ]),
    labeledInput('Cupón de descuento', { name: 'coupon', maxlength: '40', autocapitalize: 'characters' }),
    node('label', { class: 'legal-check' }, [node('input', { name: 'terms', type: 'checkbox', required: true }), node('span', { text: 'Confirmo que los datos son correctos y acepto las condiciones de compra, cambios y privacidad.' })]),
    message, node('button', { class: 'button primary', type: 'submit', text: 'CONFIRMAR PEDIDO' })
  ]);
  form._message = message;
  replace($('#app'), node('section', { class: 'section' }, [node('div', { class: 'section-head' }, node('div', {}, [node('h1', { text: 'Finalizá tu compra' }), node('p', { text: 'Pedido seguro vinculado con SPORTIME.' })])), node('div', { class: 'checkout-layout' }, [node('div', { class: 'panel' }, form), checkoutSummary()]) ]));
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form), delivery = data.get('delivery'), payment = data.get('payment');
  form._message.textContent = '';
  if (delivery === 'shipping' && !String(data.get('shipping_address') || '').trim()) { form._message.textContent = 'Ingresá la dirección de entrega.'; return; }
  const items = state.cart.map(item => ({ variant_id: item.variant.id, quantity: item.quantity }));
  let token = sessionStorage.getItem('sportime.checkout.token');
  if (!token) { token = crypto.randomUUID(); sessionStorage.setItem('sportime.checkout.token', token); }
  loading(true, 'Validando stock y registrando pedido…');
  try {
    await api.rpc('update_my_sportime_profile', { p_full_name: data.get('full_name'), p_phone: data.get('phone'), p_dni: data.get('dni'), p_birth_date: state.profile.birth_date || null, p_address: data.get('billing_address') });
    const result = await api.rpc('place_sportime_order_v4', {
      p_items: items,
      p_delivery_data: { delivery, payment, address: String(data.get('shipping_address') || '').trim(), billing_address: String(data.get('billing_address') || '').trim(), notes: String(data.get('notes') || '').trim(), source: 'sportime_web_secure' },
      p_coupon_code: String(data.get('coupon') || '').trim().toUpperCase() || null,
      p_checkout_token: token
    });
    sessionStorage.removeItem('sportime.checkout.token');
    state.cart = []; updateCartCount(); await Promise.all([loadCatalog(false), loadMyOrders()]);
    renderCheckoutSuccess(result, payment);
  } catch (error) { form._message.textContent = friendlyError(error); toast(friendlyError(error), 'error'); }
  finally { loading(false); }
}

function renderCheckoutSuccess(result, payment) {
  const transfer = payment === 'transfer' ? node('div', { class: 'notice' }, [node('h3', { text: 'Datos para transferir' }), node('p', { text: `Titular: ${state.settings.transfer_holder || '-'} · Alias: ${state.settings.transfer_alias || '-'} · CBU/CVU: ${state.settings.transfer_cbu || '-'}` }), node('p', { class: 'meta', text: 'Indicá el número de pedido al enviar el comprobante.' })]) : null;
  replace($('#app'), node('section', { class: 'section' }, node('div', { class: 'panel' }, [node('span', { class: 'eyebrow', text: 'PEDIDO REGISTRADO' }), node('h1', { text: `Pedido #${result.order_number}` }), node('p', { text: `Total confirmado: ${money(result.total)}` }), result.discount > 0 && node('p', { text: `Descuento aplicado: ${money(result.discount)} (${result.coupon_code})` }), transfer, node('div', { class: 'button-row' }, [node('a', { class: 'button primary', href: '#cuenta', text: 'VER MIS COMPRAS' }), node('a', { class: 'button secondary', href: '#catalogo', text: 'SEGUIR COMPRANDO' })])])));
}

function setAdminMenu(open) {
  state.adminMenuOpen = Boolean(open);
  document.body.classList.toggle('admin-menu-open', state.adminMenuOpen);
  document.querySelector('.admin-nav')?.classList.toggle('open', state.adminMenuOpen);
  document.querySelector('.admin-backdrop')?.classList.toggle('show', state.adminMenuOpen);
  document.querySelector('.admin-menu-button')?.setAttribute('aria-expanded', String(state.adminMenuOpen));
}
function adminNav() {
  const tabs = [['dashboard','Resumen'],['products','Productos web'],['orders','Pedidos'],['withdrawals','Arrepentimientos'],['customers','Clientes'],['settings','Tienda'],['coupons','Cupones']];
  return node('nav', { class: `admin-nav ${state.adminMenuOpen ? 'open' : ''}`, 'aria-label': 'Administración', id: 'admin-navigation' }, [
    node('div', { class: 'admin-nav-head' }, [node('h2', { text: 'ADMINISTRACIÓN' }), node('button', { class: 'admin-nav-close', type: 'button', 'aria-label': 'Cerrar menú', text: '×', onclick: () => setAdminMenu(false) })]),
    ...tabs.map(([id,label]) => node('button', { class: state.adminTab === id ? 'active' : '', type: 'button', text: label, onclick: () => { state.adminTab = id; state.adminMenuOpen = false; document.body.classList.remove('admin-menu-open'); renderAdmin(); } }))
  ]);
}

async function renderAdmin() {
  if (!api.user || !state.profile) { openAccount('login'); location.hash = '#inicio'; return; }
  if (!isStaff()) { location.hash = '#cuenta'; toast('Tu cuenta no tiene permisos administrativos.', 'error'); return; }
  const root = $('#app');
  const content = node('section', { class: 'admin-main' }, node('div', { class: 'notice', text: 'Cargando administración…' }));
  const mobileBar = node('div', { class: 'admin-mobile-bar' }, [
    node('button', { class: 'admin-menu-button', type: 'button', 'aria-controls': 'admin-navigation', 'aria-expanded': String(state.adminMenuOpen), onclick: () => setAdminMenu(!state.adminMenuOpen) }, [node('span', { 'aria-hidden': 'true', text: '☰' }), node('span', { text: 'MENÚ DE ADMINISTRACIÓN' })]),
    node('b', { text: ({dashboard:'Resumen',products:'Productos',orders:'Pedidos',withdrawals:'Arrepentimientos',customers:'Clientes',settings:'Tienda',coupons:'Cupones'})[state.adminTab] || 'Administración' })
  ]);
  const backdrop = node('button', { class: `admin-backdrop ${state.adminMenuOpen ? 'show' : ''}`, type: 'button', 'aria-label': 'Cerrar menú', onclick: () => setAdminMenu(false) });
  replace(root, mobileBar, node('div', { class: 'admin-layout' }, [adminNav(), backdrop, content]));
  try {
    if (state.adminTab === 'dashboard') await adminDashboard(content);
    if (state.adminTab === 'products') await adminProducts(content);
    if (state.adminTab === 'orders') await adminOrders(content);
    if (state.adminTab === 'withdrawals') await adminWithdrawals(content);
    if (state.adminTab === 'customers') await adminCustomers(content);
    if (state.adminTab === 'settings') await adminSettings(content);
    if (state.adminTab === 'coupons') await adminCoupons(content);
  } catch (error) { replace(content, node('div', { class: 'notice danger', text: friendlyError(error) })); }
}

async function adminWithdrawals(root) {
  const requests = await api.rest('withdrawal_requests', { query: { select: '*', order: 'created_at.desc', limit: '500' } });
  const labels = { received: 'Recibido', in_review: 'En revisión', resolved: 'Resuelto', rejected: 'Rechazado' };
  const table = node('table', { class: 'data-table' }, [node('thead', {}, node('tr', {}, ['Gestión','Pedido','Cliente','Solicitud','Estado','Fecha'].map(text => node('th', { text }))))]);
  table.append(node('tbody', {}, requests.map(request => {
    const select = node('select', { onchange: async event => {
      loading(true, 'Actualizando solicitud…');
      try { await api.rpc('admin_set_sportime_withdrawal_status', { p_request_id: request.id, p_status: event.target.value }); toast('Solicitud actualizada.', 'success'); await adminWithdrawals(root); }
      catch (error) { toast(friendlyError(error), 'error'); }
      finally { loading(false); }
    } }, Object.entries(labels).map(([value,label]) => node('option', { value, selected: request.status === value, text: label })));
    return node('tr', {}, [node('td', {}, node('b', { text: `#${request.request_number}` })), node('td', { text: request.order_number ? `#${request.order_number}` : '-' }), node('td', {}, [node('b', { text: request.full_name }), node('div', { class: 'meta', text: `${request.email} · ${request.phone || ''}` })]), node('td', { text: request.reason }), node('td', {}, select), node('td', { text: formatDate(request.created_at) })]);
  })));
  replace(root, adminTitle('Botón de arrepentimiento', 'Solicitudes registradas desde la tienda, incluso sin cuenta.'), node('div', { class: 'panel table-wrap' }, requests.length ? table : node('div', { class: 'empty-state', text: 'No hay solicitudes registradas.' })));
}

function adminTitle(title, subtitle = '') { return node('div', { class: 'section-head' }, node('div', {}, [node('h1', { text: title }), subtitle && node('p', { text: subtitle })])); }

async function adminDashboard(root) {
  const [products, orders, profiles] = await Promise.all([
    loadCatalog(true),
    api.rest('orders', { query: { select: 'id,total,status,created_at', order: 'created_at.desc', limit: '250' } }),
    api.rest('profiles', { query: { select: 'id,role', limit: '1000' } })
  ]);
  state.adminOrders = orders; state.adminProfiles = profiles;
  const sales = orders.filter(order => order.status !== 'cancelled').reduce((sum, order) => sum + Number(order.total || 0), 0);
  replace(root, adminTitle('Resumen', 'Vista central vinculada con Supabase y el sistema de gestión.'), node('div', { class: 'kpis' }, [
    ['Productos',products.length],['Publicados',products.filter(item => item.published).length],['Pedidos',orders.length],['Ventas',money(sales)]
  ].map(([label,value]) => node('div', { class: 'kpi' }, [node('b', { text: value }), node('span', { text: label })]))),
  node('div', { class: 'panel' }, [node('h2', { text: 'Reglas de sincronización' }), node('p', { text: 'SKU, nombre base, marca, categoría, talles, precios y stock se modifican únicamente desde el programa de PC. Esta administración controla publicación, descripción, imágenes y presentación web.' })]));
}

async function adminProducts(root) {
  await loadCatalog(true);
  if (!state.selectedAdminProduct || !state.adminProducts.some(item => item.id === state.selectedAdminProduct)) state.selectedAdminProduct = state.adminProducts[0]?.id || null;
  const selected = state.adminProducts.find(item => item.id === state.selectedAdminProduct);
  const published = state.adminProducts.filter(product => product.published).length;
  const list = node('div', { class: 'panel admin-list' }, state.adminProducts.map(product => node('button', { type: 'button', class: product.id === state.selectedAdminProduct ? 'active' : '', dataset: { adminSearch: normalized([product.name,product.sku,product.brand,product.category].join(' ')) }, onclick: () => { state.selectedAdminProduct = product.id; adminProducts(root); } }, [
    node('div', { class: 'admin-product-line' }, [node('b', { text: product.name }), node('span', { class: `publication-state ${product.published ? 'published' : ''}`, text: product.published ? 'PUBLICADO' : 'BORRADOR' })]),
    node('div', { class: 'meta', text: `${product.sku} · ${money(productPrice(product))} · ${totalStock(product)} u.` })
  ])));
  const search = node('input', { type: 'search', placeholder: 'Buscar por nombre, código, marca o categoría', oninput: event => { const q=normalized(event.target.value); list.querySelectorAll('[data-admin-search]').forEach(button=>button.hidden=q&&!button.dataset.adminSearch.includes(q)); } });
  const scanButton = node('button', { class: 'button barcode-button', type: 'button', onclick: () => openBarcodeScanner(root) }, [node('span', { 'aria-hidden': 'true', text: '▤' }), node('span', { text: 'ESCANEAR CÓDIGO' })]);
  replace(root, adminTitle('Productos web', `${published} publicados de ${state.adminProducts.length}. Los artículos nuevos llegan como borrador para que puedas revisar su presentación.`), node('div', { class: 'admin-products-toolbar' }, [search, scanButton]), node('div', { class: 'admin-product-grid' }, [list, selected ? productEditor(selected, root) : node('div', { class: 'empty-state', text: 'No hay productos sincronizados.' })]));
}

function findProductByBarcode(value) {
  const code = String(value || '').trim();
  if (!code) return null;
  return state.adminProducts.find(product => product.sku === code || product.variants.some(variant => variant.barcode === code));
}

function openBarcodeScanner(root) {
  let stream = null;
  let scanning = true;
  let detector = null;
  const status = node('p', { class: 'scanner-status', text: 'Preparando cámara…' });
  const video = node('video', { class: 'barcode-video', autoplay: true, muted: true, playsinline: true });
  const manual = node('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Escribí o pegá el código' });
  const stop = () => { scanning = false; stream?.getTracks().forEach(track => track.stop()); video.srcObject = null; };
  const selectCode = code => {
    const product = findProductByBarcode(code);
    if (!product) { status.className = 'scanner-status error'; status.textContent = `No se encontró el código ${code}.`; return false; }
    stop(); state.selectedAdminProduct = product.id; dialog.close(); adminProducts(root); toast(`${product.name} encontrado.`, 'success'); return true;
  };
  const dialog = node('dialog', { class: 'barcode-dialog', onclose: stop }, node('div', { class: 'barcode-card' }, [
    node('div', { class: 'scanner-head' }, [node('div', {}, [node('h2', { text: 'Escanear código de barras' }), node('p', { text: 'Apuntá la cámara al código del producto.' })]), node('button', { class: 'scanner-close', type: 'button', 'aria-label': 'Cerrar', onclick: () => dialog.close(), text: '×' })]),
    node('div', { class: 'scanner-viewport' }, [video, node('div', { class: 'scanner-frame', 'aria-hidden': 'true' }), node('div', { class: 'scanner-line', 'aria-hidden': 'true' })]),
    status,
    node('form', { class: 'scanner-manual', onsubmit: event => { event.preventDefault(); selectCode(manual.value); } }, [manual, node('button', { class: 'button secondary', type: 'submit', text: 'BUSCAR CÓDIGO' })])
  ]));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream; await video.play();
      if (!('BarcodeDetector' in window)) { status.textContent = 'Este navegador no permite lectura automática. Podés escribir el código debajo.'; return; }
      const supported = await BarcodeDetector.getSupportedFormats();
      const wanted = ['ean_13','ean_8','upc_a','upc_e','code_128'].filter(format => supported.includes(format));
      detector = new BarcodeDetector(wanted.length ? { formats: wanted } : undefined);
      status.textContent = 'Cámara lista. Mantené el código dentro del recuadro.';
      const detect = async () => {
        if (!scanning || dialog.open === false) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue && selectCode(codes[0].rawValue)) return;
        } catch { /* continúa intentando mientras la cámara esté abierta */ }
        if (scanning) setTimeout(detect, 180);
      };
      detect();
    } catch {
      status.className = 'scanner-status error';
      status.textContent = 'No se pudo abrir la cámara. Revisá el permiso del navegador o ingresá el código manualmente.';
    }
  })();
}

function productEditor(product, root) {
  const message = node('div', { class: 'form-error', role: 'alert' });
  const form = node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); loading(true, 'Guardando producto web…');
    try {
      const extraData = { ...(product.extraData || {}), transfer_price: Number(data.get('transfer_price')) || 0 };
      const body = { product_id: product.id, web_title: data.get('web_title'), slug: data.get('slug'), description: data.get('description'), short_description: data.get('short_description'), is_published: data.get('published') === 'on', featured: data.get('featured') === 'on', new_product: data.get('new_product') === 'on', hot: data.get('hot') === 'on', size_guide_url: data.get('size_guide_url') || null, video_url: data.get('video_url') || null, seo_title: data.get('seo_title') || null, seo_description: data.get('seo_description') || null, extra_data: extraData };
      await api.rpc('admin_update_sportime_product', { p_product_id: product.id, p_product: { list_price: Number(data.get('card_price')) || 0, transfer_price: Number(data.get('transfer_price')) || 0, cash_price: Number(data.get('cash_price')) || 0 } });
      await api.rest('product_web_details', { method: 'POST', query: { on_conflict: 'product_id' }, body, prefer: 'resolution=merge-duplicates,return=representation' });
      await Promise.all([loadCatalog(true), loadCatalog(false)]); message.className = 'form-success'; message.textContent = 'Producto web actualizado.'; renderCategories(); toast('Cambios publicados.', 'success');
    } catch (error) { message.textContent = friendlyError(error); }
    finally { loading(false); }
  } }, [
    node('div', { class: 'notice' }, [node('b', { text: 'Datos sincronizados' }), node('p', { text: `${product.baseName} · SKU ${product.sku} · ${product.brand} · ${product.category} · Stock ${totalStock(product)}` })]),
    node('div', { class: 'form-grid' }, [labeledInput('Precio tarjeta / lista', { name: 'card_price', type: 'number', min: '0', step: '0.01', value: product.listPrice }), labeledInput('Precio transferencia', { name: 'transfer_price', type: 'number', min: '0', step: '0.01', value: product.transferPrice }), labeledInput('Precio efectivo', { name: 'cash_price', type: 'number', min: '0', step: '0.01', value: product.cashPrice })]),
    labeledInput('Título para la web', { name: 'web_title', value: product.name, maxlength: '160', required: true }),
    labeledInput('URL amigable (ejemplo: remera-deportiva-negra)', { name: 'slug', value: product.slug, maxlength: '180', pattern: '[a-z0-9-]+' }),
    node('label', { class: 'field' }, [node('span', { text: 'Descripción corta' }), node('textarea', { name: 'short_description', rows: '2', maxlength: '320', text: product.shortDescription })]),
    node('label', { class: 'field' }, [node('span', { text: 'Descripción completa' }), node('textarea', { name: 'description', rows: '8', maxlength: '8000', text: product.description })]),
    node('div', { class: 'choice-list' }, [
      node('label', { class: 'choice' }, [node('input', { type: 'checkbox', name: 'published', checked: product.published }), node('b', { text: 'Publicado en la tienda' })]),
      node('label', { class: 'choice' }, [node('input', { type: 'checkbox', name: 'featured', checked: product.featured }), node('span', { text: 'Destacado' })]),
      node('label', { class: 'choice' }, [node('input', { type: 'checkbox', name: 'new_product', checked: product.isNew }), node('span', { text: 'Nuevo' })]),
      node('label', { class: 'choice' }, [node('input', { type: 'checkbox', name: 'hot', checked: product.hot }), node('span', { text: 'Hot Sale' })])
    ]),
    labeledInput('Guía de talles (URL HTTPS)', { name: 'size_guide_url', type: 'url', value: product.sizeGuide, maxlength: '500' }),
    labeledInput('Video (URL HTTPS)', { name: 'video_url', type: 'url', value: product.video, maxlength: '500' }),
    labeledInput('Título SEO', { name: 'seo_title', value: product.seoTitle, maxlength: '70' }),
    node('label', { class: 'field' }, [node('span', { text: 'Descripción SEO' }), node('textarea', { name: 'seo_description', rows: '2', maxlength: '170', text: product.seoDescription })]),
    message, node('button', { class: 'button primary', type: 'submit', text: 'GUARDAR PRESENTACIÓN WEB' })
  ]);
  const processFiles=async files=>{const selected=[...files].slice(0,Math.max(0,8-product.images.length));if(!selected.length)return toast('El producto ya tiene el máximo de 8 imágenes.','error');for(const file of selected)await uploadProductImage(product,file,root,false);await adminProducts(root)};
  const galleryInput=node('input',{class:'image-source-input',type:'file',accept:CONFIG.allowedImageTypes.join(','),multiple:true,onchange:event=>processFiles(event.target.files)});
  const cameraInput=node('input',{class:'image-source-input',type:'file',accept:'image/jpeg,image/png,image/webp',capture:'environment',onchange:event=>processFiles(event.target.files)});
  const imageActions=node('div',{class:'image-upload-actions'},[
    node('button',{class:'button camera-button',type:'button',onclick:()=>cameraInput.click()},[node('span',{'aria-hidden':'true',text:'📷'}),node('span',{text:'TOMAR FOTO'})]),
    node('button',{class:'button secondary',type:'button',onclick:()=>galleryInput.click()},[node('span',{'aria-hidden':'true',text:'▧'}),node('span',{text:'ELEGIR IMÁGENES'})]),
    cameraInput,galleryInput
  ]);
  return node('div', {}, [node('div', { class: 'panel' }, [node('h2', { text: product.name }), form]), node('div', { class: 'panel' }, [node('h2', { text: `Imágenes (${product.images.length}/8)` }), node('p', { class: 'helper-text', text: 'Desde el celular podés tomar la foto en el momento con la cámara trasera o elegir imágenes de la galería. Se guardan en Supabase y la primera queda como portada. JPG, PNG o WebP, máximo 8 MB cada una.' }), imageActions, node('div', { class: 'image-admin-grid' }, product.images.map(image => node('div', { class: 'image-admin' }, [node('img', { src: image.url, alt: image.alt || '' }), node('button', { class: 'button danger', type: 'button', text: 'ELIMINAR', onclick: () => deleteProductImage(product, image, root) })])))])]);
}

async function uploadProductImage(product, file, root, refresh=true) {
  if (!file) return;
  const currentProduct=state.adminProducts.find(item=>item.id===product.id)||product;
  if (currentProduct.images.length >= 8) return toast('El máximo es de 8 imágenes por producto.', 'error');
  if (!CONFIG.allowedImageTypes.includes(file.type)) return toast('Formato no permitido. Usá JPG, PNG o WebP.', 'error');
  if (file.size > CONFIG.maxUploadBytes) return toast('La imagen supera los 8 MB.', 'error');
  loading(true, 'Subiendo imagen…');
  try {
    const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
    const path = `products/${product.id}/${crypto.randomUUID()}.${extension}`;
    await api.upload('sportime-products', path, file);
    const publicUrl = api.publicObjectUrl('sportime-products', path);
    await api.rest('product_images', { method: 'POST', body: { product_id: product.id, storage_path: path, public_url: publicUrl, alt_text: product.name, is_primary: currentProduct.images.length === 0, sort_order: currentProduct.images.length }, prefer: 'return=representation' });
    await Promise.all([loadCatalog(true), loadCatalog(false)]); toast('Imagen subida.', 'success'); if(refresh) await adminProducts(root);
  } catch (error) { toast(friendlyError(error), 'error'); }
  finally { loading(false); }
}

async function deleteProductImage(product, image, root) {
  if (!await confirmAction('Eliminar imagen', 'La imagen se quitará de la tienda y del almacenamiento.')) return;
  loading(true, 'Eliminando imagen…');
  try {
    await api.rest('product_images', { method: 'DELETE', query: { id: `eq.${image.id}` } });
    if (image.path) await api.removeStorageObjects('sportime-products', [image.path]);
    await Promise.all([loadCatalog(true), loadCatalog(false)]); toast('Imagen eliminada.', 'success'); await adminProducts(root);
  } catch (error) { toast(friendlyError(error), 'error'); }
  finally { loading(false); }
}

async function adminOrders(root) {
  state.adminOrders = await api.rest('orders', { query: { select: '*,order_items(*)', order: 'created_at.desc', limit: '500' } });
  const table = node('table', { class: 'data-table' }, [node('thead', {}, node('tr', {}, ['Pedido','Cliente','Total','Pago','Estado','Fecha'].map(text => node('th', { text }))))]);
  const body = node('tbody');
  state.adminOrders.forEach(order => {
    const select = node('select', { 'aria-label': `Estado del pedido ${order.order_number}`, onchange: async event => {
      const next = event.target.value; loading(true, 'Actualizando pedido…');
      try { await api.rpc('admin_set_sportime_order_status_v2', { p_order_id: order.id, p_status: next }); toast('Estado actualizado.', 'success'); await adminOrders(root); }
      catch (error) { toast(friendlyError(error), 'error'); await adminOrders(root); }
      finally { loading(false); }
    } }, ['pending','confirmed','preparing','shipped','delivered','cancelled'].map(value => node('option', { value, selected: order.status === value, text: orderStatus(value) })));
    body.append(node('tr', {}, [node('td', {}, [node('b', { text: `#${order.order_number}` }), node('div', { class: 'meta', text: `${order.order_items?.length || 0} líneas` }), node('button', { class:'button secondary', type:'button', text:'VER RESUMEN', onclick:()=>openOrderSummary(order) })]), node('td', {}, [node('b', { text: order.customer_name }), node('div', { class: 'meta', text: order.customer_email || '' })]), node('td', { text: money(order.total) }), node('td', { text: order.payment_method || '-' }), node('td', {}, select), node('td', { text: formatDate(order.created_at) })]));
  });
  table.append(body);
  replace(root, adminTitle('Pedidos', 'Los cambios de estado y reintegros de stock se validan en Supabase.'), node('div', { class: 'panel table-wrap' }, state.adminOrders.length ? table : node('div', { class: 'empty-state', text: 'Todavía no hay pedidos.' })));
}

function openOrderSummary(order){
  const delivery=order.delivery_data||{};
  const dialog=node('dialog',{class:'modal'},node('div',{class:'modal-card'},[
    node('button',{class:'close-button',type:'button',text:'×',onclick:()=>dialog.close()}),
    node('h2',{text:`Pedido #${order.order_number}`}),
    node('div',{class:'order-detail-grid'},[
      node('div',{class:'order-detail-block'},[node('h3',{text:'Cliente'}),node('p',{text:order.customer_name||'-'}),node('p',{class:'meta',text:[order.customer_email,order.customer_phone].filter(Boolean).join(' · ')||'-'})]),
      node('div',{class:'order-detail-block'},[node('h3',{text:'Entrega'}),node('p',{text:delivery.delivery==='shipping'?'Envío a domicilio':'Retiro en local'}),node('p',{class:'meta',text:delivery.address||order.shipping_address||'Sin dirección informada'}),node('p',{class:'meta',text:delivery.notes||order.notes||''})]),
      node('div',{class:'order-detail-block full'},[node('h3',{text:'Productos'}),...(order.order_items||[]).map(item=>node('div',{class:'summary-line'},[node('span',{text:`${item.quantity} × ${item.product_name} · ${item.variant_name||''}`}),node('b',{text:money(item.line_total)})])),node('div',{class:'summary-total'},[node('span',{text:'Total'}),node('b',{text:money(order.total)})])])
    ])
  ]));
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}

async function adminCustomers(root) {
  state.adminProfiles = await api.rest('profiles', { query: { select: 'id,email,full_name,phone,dni,birth_date,address,role,created_at', order: 'created_at.desc', limit: '1000' } });
  const table = node('table', { class: 'data-table' }, [node('thead', {}, node('tr', {}, ['Cliente','Contacto','DNI','Dirección','Rol'].map(text => node('th', { text }))))]);
  table.append(node('tbody', {}, state.adminProfiles.map(profile => node('tr', {}, [node('td', {}, [node('b', { text: profile.full_name || '-' }), node('div', { class: 'meta', text: profile.email || '' })]), node('td', { text: profile.phone || '-' }), node('td', { text: profile.dni || '-' }), node('td', { text: profile.address || '-' }), node('td', {}, node('span', { class: 'status', text: profile.role }))]))));
  replace(root, adminTitle('Clientes', 'Datos protegidos: solo visibles para personal autorizado.'), node('div', { class: 'panel table-wrap' }, table));
}

async function adminSettings(root) {
  if (!isOwner()) return replace(root, adminTitle('Tienda'), node('div', { class: 'notice warning', text: 'Solo el administrador principal puede modificar la configuración comercial.' }));
  const settings = await api.rpc('get_sportime_admin_settings');
  const message = node('div', { class: 'form-error', role: 'alert' });
  const form = node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); loading(true, 'Guardando configuración…');
    try { await api.rpc('set_sportime_storefront_settings', { p_settings: data }); await loadSettings(); message.className = 'form-success'; message.textContent = 'Configuración guardada.'; toast('Tienda actualizada.', 'success'); }
    catch (error) { message.textContent = friendlyError(error); }
    finally { loading(false); }
  } }, node('div', { class: 'form-grid' }, [
    labeledInput('Nombre de la tienda', { name: 'store_name', value: settings.store_name || 'SPORTIME', maxlength: '80', required: true }),
    labeledInput('Razón social / titular', { name: 'business_name', value: settings.business_name || '', maxlength: '160' }),
    labeledInput('CUIT', { name: 'cuit', value: settings.cuit || '', maxlength: '13', pattern: '[0-9-]*' }),
    labeledInput('WhatsApp con código de país', { name: 'whatsapp', value: settings.whatsapp || '', maxlength: '24' }),
    labeledInput('Email comercial', { name: 'email', type: 'email', value: settings.email || '', maxlength: '254' }),
    labeledInput('Dirección del local', { name: 'address', value: settings.address || '', maxlength: '240' }),
    labeledInput('Texto superior', { name: 'topbar', value: settings.topbar || '', maxlength: '160', class: 'full' }),
    labeledInput('Etiqueta del banner', { name: 'hero_kicker', value: settings.hero_kicker || '', maxlength: '50' }),
    labeledInput('Título del banner', { name: 'hero_title', value: settings.hero_title || '', maxlength: '100' }),
    labeledInput('Texto del banner', { name: 'hero_text', value: settings.hero_text || '', maxlength: '300', class: 'full' }),
    labeledInput('Botón del banner', { name: 'hero_button', value: settings.hero_button || '', maxlength: '40' }),
    labeledInput('Imagen del banner (HTTPS)', { name: 'hero_image', type: 'url', value: settings.hero_image || '', maxlength: '500' }),
    labeledInput('Titular de transferencia', { name: 'transfer_holder', value: settings.transfer_holder || '', maxlength: '120' }),
    labeledInput('Alias', { name: 'transfer_alias', value: settings.transfer_alias || '', maxlength: '80' }),
    labeledInput('CBU/CVU', { name: 'transfer_cbu', value: settings.transfer_cbu || '', maxlength: '30' }),
    labeledInput('Horas de reserva en efectivo', { name: 'cash_reservation_hours', type: 'number', min: '1', max: '168', value: settings.cash_reservation_hours || 48 }),
    node('label', { class: 'field full' }, [node('span', { text: 'Política de envíos' }), node('textarea', { name: 'shipping_policy', rows: '5', maxlength: '5000', text: settings.shipping_policy || '' })]),
    node('label', { class: 'field full' }, [node('span', { text: 'Política de cambios y devoluciones' }), node('textarea', { name: 'returns_policy', rows: '5', maxlength: '5000', text: settings.returns_policy || '' })]),
    node('label', { class: 'field full' }, [node('span', { text: 'Política de privacidad' }), node('textarea', { name: 'privacy_policy', rows: '7', maxlength: '5000', text: settings.privacy_policy || '' })]),
    node('label', { class: 'field full' }, [node('span', { text: 'Términos de compra' }), node('textarea', { name: 'terms_policy', rows: '7', maxlength: '5000', text: settings.terms_policy || '' })])
  ]));
  form.append(message, node('button', { class: 'button primary', type: 'submit', text: 'GUARDAR CONFIGURACIÓN' }));
  const bannerUpload=node('input',{type:'file',accept:CONFIG.allowedImageTypes.join(','),onchange:async event=>{const file=event.target.files?.[0];if(!file)return;if(!CONFIG.allowedImageTypes.includes(file.type)||file.size>CONFIG.maxUploadBytes)return toast('Usá JPG, PNG o WebP de hasta 8 MB.','error');loading(true,'Subiendo banner…');try{const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type],path=`banners/${crypto.randomUUID()}.${ext}`;await api.upload('sportime-products',path,file);form.elements.hero_image.value=api.publicObjectUrl('sportime-products',path);toast('Banner cargado. Presioná Guardar configuración.','success')}catch(error){toast(friendlyError(error),'error')}finally{loading(false)}}});
  const bannerPanel=node('div',{class:'panel'},[node('h2',{text:'Banner principal'}),node('p',{class:'helper-text',text:'Subí una imagen horizontal JPG, PNG o WebP. Recomendado: 1920 × 700 px. Se guarda en Supabase y queda aplicada cuando guardás la configuración.'}),bannerUpload,settings.hero_image&&node('img',{class:'banner-preview',src:safeUrl(settings.hero_image),alt:'Banner actual'})]);
  replace(root, adminTitle('Tienda', 'Datos comerciales, medios de pago y presentación de la vidriera.'), bannerPanel, node('div', { class: 'panel' }, form));
}

async function adminCoupons(root) {
  if (!isOwner()) return replace(root, adminTitle('Cupones'), node('div', { class: 'notice warning', text: 'Solo el administrador principal puede gestionar cupones.' }));
  state.coupons = await api.rpc('admin_list_sportime_coupons');
  const addButton = node('button', { class: 'button primary', type: 'button', text: 'NUEVO CUPÓN', onclick: () => editCoupon(null, root) });
  const table = node('table', { class: 'data-table' }, [node('thead', {}, node('tr', {}, ['Código','Tipo','Valor','Mínimo','Vigencia','Uso','Estado',''].map(text => node('th', { text }))))]);
  table.append(node('tbody', {}, state.coupons.map(coupon => node('tr', {}, [node('td', {}, node('b', { text: coupon.code })), node('td', { text: coupon.kind }), node('td', { text: coupon.kind === 'percent' ? `${coupon.value}%` : money(coupon.value) }), node('td', { text: money(coupon.minimum) }), node('td', { text: [coupon.starts_at ? formatDate(coupon.starts_at) : 'Ahora', coupon.ends_at ? formatDate(coupon.ends_at) : 'Sin vencimiento'].join(' → ') }), node('td', { text: `${coupon.used_count || 0}${coupon.usage_limit ? ` / ${coupon.usage_limit}` : ''}` }), node('td', {}, node('span', { class: `status ${coupon.active ? 'delivered' : 'cancelled'}`, text: coupon.active ? 'Activo' : 'Pausado' })), node('td', {}, node('div', { class: 'button-row' }, [node('button', { class: 'button secondary', type: 'button', text: 'Editar', onclick: () => editCoupon(coupon, root) }), node('button', { class: 'button danger', type: 'button', text: 'Eliminar', onclick: () => deleteCoupon(coupon, root) })]))]))));
  replace(root, adminTitle('Cupones', 'Los códigos ya no se exponen en la configuración pública.'), addButton, node('div', { class: 'panel table-wrap' }, state.coupons.length ? table : node('div', { class: 'empty-state', text: 'No hay cupones configurados.' })));
}

function editCoupon(coupon, root) {
  const dialog = $('#account-dialog'), host = $('#account-content'), error = node('div', { class: 'form-error', role: 'alert' });
  const form = node('form', { class: 'form', onsubmit: async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); loading(true, 'Guardando cupón…');
    try {
      await api.rpc('admin_upsert_sportime_coupon', { p_original_code: coupon?.code || null, p_coupon: { code: String(data.get('code')).toUpperCase(), kind: data.get('kind'), value: Number(data.get('value')), minimum: Number(data.get('minimum')), active: data.get('active') === 'on', usage_limit: data.get('usage_limit') ? Number(data.get('usage_limit')) : null, starts_at: data.get('starts_at') || null, ends_at: data.get('ends_at') || null } });
      dialog.close(); toast('Cupón guardado.', 'success'); await adminCoupons(root);
    } catch (e) { error.textContent = friendlyError(e); }
    finally { loading(false); }
  } }, [
    labeledInput('Código', { name: 'code', value: coupon?.code || '', maxlength: '40', pattern: '[A-Za-z0-9_-]+', required: true }),
    node('label', { class: 'field' }, [node('span', { text: 'Tipo' }), node('select', { name: 'kind' }, [node('option', { value: 'percent', selected: coupon?.kind !== 'amount', text: 'Porcentaje' }), node('option', { value: 'amount', selected: coupon?.kind === 'amount', text: 'Monto fijo' })])]),
    labeledInput('Valor', { name: 'value', type: 'number', min: '0.01', step: '0.01', value: coupon?.value || 10, required: true }),
    labeledInput('Compra mínima', { name: 'minimum', type: 'number', min: '0', step: '0.01', value: coupon?.minimum || 0 }),
    labeledInput('Límite de usos (vacío = ilimitado)', { name: 'usage_limit', type: 'number', min: '1', value: coupon?.usage_limit || '' }),
    labeledInput('Inicio', { name: 'starts_at', type: 'datetime-local', value: coupon?.starts_at ? new Date(coupon.starts_at).toISOString().slice(0,16) : '' }),
    labeledInput('Fin', { name: 'ends_at', type: 'datetime-local', value: coupon?.ends_at ? new Date(coupon.ends_at).toISOString().slice(0,16) : '' }),
    node('label', { class: 'choice' }, [node('input', { name: 'active', type: 'checkbox', checked: coupon?.active !== false }), node('b', { text: 'Cupón activo' })]), error,
    node('button', { class: 'button primary', type: 'submit', text: 'GUARDAR CUPÓN' })
  ]);
  replace(host, authHeader(coupon ? 'Editar cupón' : 'Nuevo cupón'), form); dialog.showModal();
}

async function deleteCoupon(coupon, root) {
  if (!await confirmAction('Eliminar cupón', `Se eliminará el cupón ${coupon.code}.`)) return;
  loading(true, 'Eliminando cupón…');
  try { await api.rpc('admin_delete_sportime_coupon', { p_code: coupon.code }); toast('Cupón eliminado.', 'success'); await adminCoupons(root); }
  catch (error) { toast(friendlyError(error), 'error'); }
  finally { loading(false); }
}

function renderRoute() {
  renderCategories();
  if (state.loading) return renderLoading();
  if (state.cloudError) return renderCloudError();
  const route = (location.hash || '#inicio').slice(1).split('?')[0];
  document.body.className=`route-${route||'inicio'}`;
  if (route === 'inicio' || !route) return renderHome();
  if (route === 'catalogo') return renderCatalog();
  if (route === 'checkout') return renderCheckout();
  if (route === 'cuenta') return renderAccountPage();
  if (route === 'admin') return renderAdmin();
  if (route === 'arrepentimiento') return renderWithdrawal();
  if (['contacto','envios','cambios','privacidad','terminos'].includes(route)) return renderStaticPage(route);
  location.hash = '#inicio';
}

function bindShell() {
  const searchInput = $('#search-input');
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); state.query = searchInput.value.trim().slice(0,80); state.category = 'Todos'; hideSearchSuggestions(); location.hash = '#catalogo'; renderRoute(); });
  searchInput.addEventListener('input', event => renderSearchSuggestions(event.target.value));
  searchInput.addEventListener('focus', event => renderSearchSuggestions(event.target.value));
  searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') hideSearchSuggestions(); });
  $('#newsletter-form')?.addEventListener('submit', event => { event.preventDefault(); event.currentTarget.reset(); toast('Gracias por sumarte a la comunidad SPORTIME.', 'success'); });
  document.addEventListener('click', event => {
    if (!event.target.closest('#search-form')) hideSearchSuggestions();
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'account') openAccount();
    if (action === 'cart') openCart();
    const close = event.target.closest('[data-close]')?.dataset.close;
    if (close) document.getElementById(close)?.close();
  });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('resize', () => { if (innerWidth > 760 && state.adminMenuOpen) setAdminMenu(false); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastCatalogLoad > CONFIG.catalogRefreshMs) {
      try { await loadCatalog(false); await loadCart(); renderCategories(); renderRoute(); } catch { /* se conserva el estado visible */ }
    }
  });
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try { await loadCatalog(false); await loadCart(); renderCategories(); renderRoute(); } catch { /* aviso de conexión principal */ }
  }, CONFIG.catalogRefreshMs);
}

async function bootstrap() {
  let callbackType = null;
  try { callbackType = await api.consumeAuthCallback(); }
  catch (error) { toast(friendlyError(error), 'error'); }
  await initialLoad();
  if (callbackType === 'recovery') renderNewPassword();
  else if (callbackType) toast('Correo confirmado. Tu cuenta ya está conectada.', 'success');
}

bindShell();
bootstrap();

