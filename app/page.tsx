import HomeClient from "@/components/home/HomeClient";

type HomePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const checkoutReference = params.sumup_checkout_reference;
  const initialPaymentReturnReference =
    typeof checkoutReference === "string" ? checkoutReference : null;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
html[data-payment-return-boot="true"] body {
  background: #000;
}
html[data-payment-return-boot="true"] body > :not(#fair-play-payment-return-boot-shell) {
  visibility: hidden;
}
#fair-play-payment-return-boot-shell {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  color: #fff;
  background: rgba(0, 0, 0, 0.9);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#fair-play-payment-return-boot-shell .payment-return-boot-modal {
  box-sizing: border-box;
  display: flex;
  width: 100vw;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(39 39 42);
  background: rgb(24 24 27);
  box-shadow: 0 24px 90px rgba(0, 0, 0, 0.55);
}
#fair-play-payment-return-boot-shell .payment-return-boot-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgb(39 39 42);
  background: rgb(24 24 27);
  padding: 10px 12px;
}
#fair-play-payment-return-boot-shell h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  font-weight: 800;
}
#fair-play-payment-return-boot-shell .payment-return-boot-close {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  color: rgb(161 161 170);
  font-size: 20px;
  line-height: 1;
}
#fair-play-payment-return-boot-shell .payment-return-boot-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-stack {
  display: grid;
  gap: 12px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-summary {
  border: 1px solid rgb(63 63 70);
  border-radius: 32px;
  background: rgb(9 9 11);
  padding: 12px;
  box-shadow: 0 20px 70px rgba(15, 23, 42, 0.55);
}
#fair-play-payment-return-boot-shell .payment-return-boot-summary-inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-summary-text {
  min-width: 0;
}
#fair-play-payment-return-boot-shell .payment-return-boot-label {
  margin: 0;
  color: rgb(113 113 122);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}
#fair-play-payment-return-boot-shell .payment-return-boot-title {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
  font-size: 18px;
  line-height: 1.35;
  font-weight: 800;
}
#fair-play-payment-return-boot-shell .payment-return-boot-meta {
  margin: 0;
  overflow-wrap: anywhere;
  color: rgb(161 161 170);
  font-size: 14px;
  line-height: 1.5;
}
#fair-play-payment-return-boot-shell .payment-return-boot-total {
  align-self: flex-start;
  border-radius: 24px;
  background: rgb(24 24 27);
  padding: 10px 16px;
  text-align: right;
}
#fair-play-payment-return-boot-shell .payment-return-boot-price {
  margin: 0;
  color: rgb(245 245 244);
  font-size: 24px;
  line-height: 1.1;
  font-weight: 800;
}
#fair-play-payment-return-boot-shell .payment-return-boot-card {
  border: 1px solid rgb(63 63 70);
  border-radius: 24px;
  background: rgb(24 24 27);
  padding: 12px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-card-copy {
  margin: 8px 0 0;
  color: rgb(161 161 170);
  font-size: 14px;
  line-height: 1.65;
}
#fair-play-payment-return-boot-shell .payment-return-boot-order {
  background: rgba(9, 9, 11, 0.8);
}
#fair-play-payment-return-boot-shell .payment-return-boot-order-grid {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-order-field {
  border-radius: 24px;
  background: rgb(24 24 27);
  padding: 12px 16px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-order-value {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
  color: #fff;
  font-size: 14px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-status {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.1);
  color: rgb(254 243 199);
  padding: 16px 20px;
  text-align: center;
}
#fair-play-payment-return-boot-shell .payment-return-boot-status-title {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 800;
}
#fair-play-payment-return-boot-shell .payment-return-boot-status-body {
  margin: 8px 0 0;
  color: rgba(254, 243, 199, 0.85);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
  white-space: pre-line;
}
#fair-play-payment-return-boot-shell .payment-return-boot-spinner {
  width: 24px;
  height: 24px;
  margin: 16px auto 0;
  border: 2px solid rgba(254, 243, 199, 0.3);
  border-top-color: rgb(254 243 199);
  border-radius: 999px;
  animation: payment-return-boot-spin 0.8s linear infinite;
}
#fair-play-payment-return-boot-shell .payment-return-boot-actions {
  display: grid;
  gap: 12px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-action-stack {
  display: grid;
  gap: 8px;
}
#fair-play-payment-return-boot-shell .payment-return-boot-primary,
#fair-play-payment-return-boot-shell .payment-return-boot-secondary {
  border-radius: 24px;
  padding: 12px 24px;
  font-weight: 800;
}
#fair-play-payment-return-boot-shell .payment-return-boot-primary {
  border: 0;
  background: rgb(231 229 228);
  color: rgb(9 9 11);
  opacity: 0.5;
}
#fair-play-payment-return-boot-shell .payment-return-boot-text-button {
  border: 0;
  background: transparent;
  color: rgb(161 161 170);
  font-size: 14px;
  font-weight: 700;
  opacity: 0.5;
}
#fair-play-payment-return-boot-shell .payment-return-boot-secondary {
  border: 1px solid rgb(63 63 70);
  background: rgb(24 24 27);
  color: #fff;
}
@media (min-width: 640px) {
  #fair-play-payment-return-boot-shell {
    align-items: center;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-modal {
    width: 88vw;
    height: 99vh;
    border-radius: 16px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-header {
    padding: 16px 24px;
  }
  #fair-play-payment-return-boot-shell h2 {
    font-size: 24px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-close {
    font-size: 24px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-content {
    padding: 28px 32px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-stack {
    gap: 24px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-summary {
    padding: 24px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-summary-inner {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-label {
    letter-spacing: 0.35em;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-title {
    margin-top: 8px;
    font-size: 20px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-total {
    align-self: auto;
    padding: 12px 16px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-price {
    font-size: 30px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-card {
    padding: 20px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-order-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 16px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-order-field {
    padding: 16px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-order-value {
    margin-top: 8px;
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-actions {
    grid-template-columns: minmax(0, 1.6fr) minmax(12rem, 0.7fr);
  }
  #fair-play-payment-return-boot-shell .payment-return-boot-primary,
  #fair-play-payment-return-boot-shell .payment-return-boot-secondary {
    padding: 16px 24px;
  }
}
@keyframes payment-return-boot-spin {
  to {
    transform: rotate(360deg);
  }
}
`,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
try {
  var params = new URLSearchParams(window.location.search);
  var hasReturnReference = params.has("sumup_checkout_reference");
  var storedReference = window.localStorage.getItem("pendingSumUpCheckoutReference");
  if (hasReturnReference || storedReference) {
    document.documentElement.setAttribute("data-payment-return-boot", "true");
    var existingShell = document.getElementById("fair-play-payment-return-boot-shell");
    if (!existingShell) {
      var snapshot = null;
      try {
        snapshot = JSON.parse(window.localStorage.getItem("pendingSumUpGameSnapshot") || "null");
      } catch (snapshotError) {}
      var shell = document.createElement("div");
      shell.id = "fair-play-payment-return-boot-shell";
      shell.setAttribute("aria-hidden", "true");
      var canPayWithWallet = !!(snapshot && snapshot.can_pay_with_wallet);
      shell.innerHTML =
        '<div class="payment-return-boot-modal">' +
          '<div class="payment-return-boot-header">' +
            '<h2>Secure checkout</h2>' +
            '<span class="payment-return-boot-close">✕</span>' +
          '</div>' +
          '<div class="payment-return-boot-content">' +
            '<div class="payment-return-boot-stack">' +
              '<div class="payment-return-boot-summary">' +
                '<div class="payment-return-boot-summary-inner">' +
                  '<div class="payment-return-boot-summary-text">' +
                    '<p class="payment-return-boot-label">Booking summary</p>' +
                    '<p class="payment-return-boot-title"></p>' +
                    '<p class="payment-return-boot-meta"></p>' +
                  '</div>' +
                  '<div class="payment-return-boot-total">' +
                    '<p class="payment-return-boot-label">Total</p>' +
                    '<p class="payment-return-boot-price"></p>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="payment-return-boot-card">' +
                '<p class="payment-return-boot-label">Secure payment</p>' +
                '<p class="payment-return-boot-card-copy"></p>' +
              '</div>' +
              '<div class="payment-return-boot-card payment-return-boot-order">' +
                '<p class="payment-return-boot-label">Order details</p>' +
                '<div class="payment-return-boot-order-grid">' +
                  '<div class="payment-return-boot-order-field">' +
                    '<p class="payment-return-boot-label">Username</p>' +
                    '<p class="payment-return-boot-order-value" data-payment-return-field="player"></p>' +
                  '</div>' +
                  '<div class="payment-return-boot-order-field">' +
                    '<p class="payment-return-boot-label">Position</p>' +
                    '<p class="payment-return-boot-order-value" data-payment-return-field="position"></p>' +
                  '</div>' +
                  '<div class="payment-return-boot-order-field">' +
                    '<p class="payment-return-boot-label">Email</p>' +
                    '<p class="payment-return-boot-order-value" data-payment-return-field="email"></p>' +
                  '</div>' +
                  '<div class="payment-return-boot-order-field">' +
                    '<p class="payment-return-boot-label">Payment</p>' +
                    '<p class="payment-return-boot-order-value" data-payment-return-field="payment"></p>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="payment-return-boot-card payment-return-boot-status">' +
                '<p class="payment-return-boot-status-title">Checking your payment...</p>' +
                '<p class="payment-return-boot-status-body">We\\'re confirming whether your payment was completed.\\nThis usually takes a few seconds.</p>' +
                '<div class="payment-return-boot-spinner"></div>' +
              '</div>' +
              '<div class="payment-return-boot-actions">' +
                '<div class="payment-return-boot-action-stack">' +
                  '<button class="payment-return-boot-primary" disabled></button>' +
                  (canPayWithWallet ? '<button class="payment-return-boot-text-button" disabled>Pay by Card</button>' : '') +
                '</div>' +
                '<button class="payment-return-boot-secondary" disabled>Back to profile</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      var title = shell.querySelector(".payment-return-boot-title");
      var meta = shell.querySelector(".payment-return-boot-meta");
      var price = shell.querySelector(".payment-return-boot-price");
      var copy = shell.querySelector(".payment-return-boot-card-copy");
      var primary = shell.querySelector(".payment-return-boot-primary");
      var player = shell.querySelector('[data-payment-return-field="player"]');
      var position = shell.querySelector('[data-payment-return-field="position"]');
      var email = shell.querySelector('[data-payment-return-field="email"]');
      var payment = shell.querySelector('[data-payment-return-field="payment"]');
      if (title) {
        title.textContent = snapshot && snapshot.title ? snapshot.title : "Game details";
      }
      if (meta) {
        var metaParts = [];
        if (snapshot && snapshot.location) metaParts.push(snapshot.location);
        if (snapshot && snapshot.time) metaParts.push(snapshot.time);
        meta.textContent = metaParts.length ? metaParts.join(" • ") : "Loading game details";
      }
      if (price) price.textContent = "£" + (snapshot && snapshot.price != null ? snapshot.price : 0);
      if (copy) {
        copy.textContent = canPayWithWallet
          ? "Use your Fair Play Football wallet balance for this booking, or pay by card instead."
          : "All card payments are processed securely through SumUp. You’ll be able to choose your preferred payment method, including card, Apple Pay or Google Pay, during checkout.";
      }
      if (primary) {
        primary.textContent = canPayWithWallet
          ? "Pay £" + (snapshot && snapshot.price != null ? snapshot.price : 0) + " with Wallet"
          : "Pay £" + (snapshot && snapshot.price != null ? snapshot.price : 0) + " with SumUp";
      }
      if (player) player.textContent = snapshot && snapshot.player_name ? snapshot.player_name : "Player";
      if (position) position.textContent = snapshot && snapshot.position ? snapshot.position : "Midfielder";
      if (email) email.textContent = snapshot && snapshot.email ? snapshot.email : "you@example.com";
      if (payment) payment.textContent = snapshot && snapshot.payment_label ? snapshot.payment_label : canPayWithWallet ? "Wallet or SumUp Secure Checkout" : "SumUp Secure Checkout";
      document.body.appendChild(shell);
    }
  }
} catch (error) {}
`,
        }}
      />
      <HomeClient initialPaymentReturnReference={initialPaymentReturnReference} />
    </>
  );
}
