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
html[data-payment-return-pending="true"] body {
  background: #000;
}
html[data-payment-return-pending="true"] body > * {
  visibility: hidden;
}
html[data-payment-return-pending="true"] body::before {
  content: "Confirming your booking\\A We\\2019re checking your payment. This may take a few moments.";
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-content: center;
  padding: 24px;
  white-space: pre-line;
  text-align: center;
  color: #fff;
  background: #000;
  font: 700 24px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
  if (!hasReturnReference && storedReference) {
    document.documentElement.setAttribute("data-payment-return-pending", "true");
  }
} catch (error) {}
`,
        }}
      />
      <HomeClient initialPaymentReturnReference={initialPaymentReturnReference} />
    </>
  );
}
