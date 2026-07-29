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
    <HomeClient initialPaymentReturnReference={initialPaymentReturnReference} />
  );
}
